/**
 * useCalibration — the 21 CFR Part 11 guards and the calibration/certificate
 * write paths of the calibration screen. Services mocked; stores real.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const calibrationService = {
  getAll: jest.fn(), getAllCertificates: jest.fn(), getCertificateStats: jest.fn(),
  create: jest.fn(), createCertificate: jest.fn(), approveCertificate: jest.fn(),
  signCertificate: jest.fn(), revokeCertificate: jest.fn(),
};
const deviceService = { getAll: jest.fn() };
jest.mock("@/api/services/calibration.service", () => ({ calibrationService }));
jest.mock("@/api/services/device.service", () => ({ deviceService }));

import { useCalibration } from "../useCalibration";
import { useAuthStore } from "@/stores/authStore";
import { useCalibrationStore } from "@/stores/calibrationStore";
import type { Calibration, Certificate } from "@/api/services/calibration.service";
import type { User } from "@/types";

const ev = { preventDefault: jest.fn() } as unknown as React.FormEvent;
const empty = { data: [], meta: { page: 1, limit: 10, totalPages: 1 } };
const cert = { id: "k1", status: "pending_approval" } as unknown as Certificate;

beforeEach(() => {
  jest.clearAllMocks();
  calibrationService.getAll.mockResolvedValue(empty);
  calibrationService.getAllCertificates.mockResolvedValue(empty);
  calibrationService.getCertificateStats.mockResolvedValue({ totalCertificates: 0 });
  deviceService.getAll.mockResolvedValue(empty);
  useCalibrationStore.setState({ error: null });
  useAuthStore.setState({
    user: { id: "u1", username: "ada", email: "a@x", role: { name: "HEALTHCARE ADMIN" } } as unknown as User,
  });
});

const setup = async () => {
  const hook = renderHook(() => useCalibration());
  await waitFor(() => expect(calibrationService.getAll).toHaveBeenCalled());
  return hook;
};

describe("useCalibration", () => {
  it("loads devices, stats, records and certificates; the filters reach the requests", async () => {
    const { result } = await setup();
    expect(result.current.hasWriteAccess).toBe(true);
    act(() => {
      result.current.setSelectedDeviceFilter("d1");
      result.current.setComplianceFilter(false);
      result.current.setCertStatusFilter(["signed"]);
      result.current.setCertNumFilter("CERT-9");
    });
    await waitFor(() =>
      expect(calibrationService.getAll).toHaveBeenLastCalledWith(1, 10, "d1", false, undefined, undefined),
    );
    expect(calibrationService.getAllCertificates).toHaveBeenLastCalledWith(
      1, 10, undefined, ["signed"], undefined, "CERT-9", undefined, undefined,
    );
  });

  it("a recorded calibration sends the deviation as a number", async () => {
    const { result } = await setup();
    calibrationService.create.mockResolvedValue({ id: "c1" });
    act(() =>
      result.current.setRecordForm((f) => ({ ...f, deviceId: "d1", results: { ...f.results, deviation: "0.25" } })),
    );
    await act(async () => result.current.handleRecordSubmit(ev));
    expect(calibrationService.create).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: "d1", results: expect.objectContaining({ deviation: 0.25 }) }),
    );
    expect(result.current.isRecordModalOpen).toBe(false);

    calibrationService.create.mockRejectedValue(new Error("Device not due"));
    act(() => result.current.setIsRecordModalOpen(true));
    await act(async () => result.current.handleRecordSubmit(ev));
    expect(result.current.isRecordModalOpen).toBe(true);
    expect(result.current.calibError).toBe("Device not due");
  });

  it("a certificate from a record defaults to one year's validity from the calibration date", async () => {
    const { result } = await setup();
    act(() =>
      result.current.openCreateCertificateModal({
        id: "c1", deviceId: "d1", calibrationDate: "2026-03-10T00:00:00Z", notes: "ok",
      } as unknown as Calibration),
    );
    expect(result.current.certForm).toMatchObject({
      deviceId: "d1", calibrationRecordId: "c1", validUntil: "2027-03-10", notes: "ok", standard: "ISO 17025",
    });
    calibrationService.createCertificate.mockResolvedValue({ id: "k2" });
    await act(async () => result.current.handleCertSubmit(ev));
    expect(result.current.isCertModalOpen).toBe(false);
  });

  it("Part 11: approval needs the signer's password; the credential is cleared after success", async () => {
    const { result } = await setup();
    act(() => result.current.openApproveModal(cert));
    await act(async () => result.current.handleApproveSubmit(ev));
    expect(result.current.calibError).toBe("Enter your password to sign this approval");
    expect(calibrationService.approveCertificate).not.toHaveBeenCalled();

    calibrationService.approveCertificate.mockResolvedValue({ ...cert, status: "approved" });
    act(() => result.current.setApproveForm((f) => ({ ...f, authPayload: "pw" })));
    await act(async () => result.current.handleApproveSubmit(ev));
    expect(calibrationService.approveCertificate).toHaveBeenCalledWith("k1", {
      approvedBy: "u1", authMethod: "password", authPayload: "pw", meaning: "Reviewed and approved",
    });
    expect(result.current.approveForm.authPayload).toBe("");
    expect(result.current.isApproveModalOpen).toBe(false);
  });

  it("Part 11: approval with no signed-in user is refused", async () => {
    const { result } = await setup();
    act(() => useAuthStore.setState({ user: null }));
    act(() => result.current.openApproveModal(cert));
    act(() => result.current.setApproveForm((f) => ({ ...f, authPayload: "pw" })));
    await act(async () => result.current.handleApproveSubmit(ev));
    expect(result.current.calibError).toBe("You must be signed in to approve a certificate");
  });

  it("Part 11: signing needs the password; a failed signature keeps the modal and the input", async () => {
    const { result } = await setup();
    act(() => result.current.openSignModal(cert));
    expect(result.current.signForm.digitalSignature).toMatch(/^SHA256withRSA:/);
    await act(async () => result.current.handleSignSubmit(ev));
    expect(result.current.calibError).toBe("Enter your password to sign this certificate");

    calibrationService.signCertificate.mockRejectedValue(new Error("Invalid credentials"));
    act(() => result.current.setSignForm((f) => ({ ...f, authPayload: "bad" })));
    await act(async () => result.current.handleSignSubmit(ev));
    expect(result.current.isSignModalOpen).toBe(true);
    expect(result.current.calibError).toBe("Invalid credentials");

    calibrationService.signCertificate.mockResolvedValue({ ...cert, status: "signed" });
    await act(async () => result.current.handleSignSubmit(ev));
    expect(result.current.isSignModalOpen).toBe(false);
    expect(result.current.signForm.authPayload).toBe("");
  });

  it("Part 11: a revocation needs a reason and the password", async () => {
    const { result } = await setup();
    act(() => result.current.openRevokeModal(cert));
    await act(async () => result.current.handleRevokeSubmit(ev));
    expect(result.current.calibError).toBe("A revocation reason is required");
    act(() => result.current.setRevokeForm((f) => ({ ...f, reason: "Wrong device" })));
    await act(async () => result.current.handleRevokeSubmit(ev));
    expect(result.current.calibError).toBe("Enter your password to sign this revocation");

    calibrationService.revokeCertificate.mockResolvedValue({ ...cert, status: "revoked" });
    act(() => result.current.setRevokeForm((f) => ({ ...f, authPayload: "pw" })));
    await act(async () => result.current.handleRevokeSubmit(ev));
    expect(calibrationService.revokeCertificate).toHaveBeenCalledWith("k1", {
      reason: "Wrong device", authMethod: "password", authPayload: "pw", meaning: "Revoked",
    });
    expect(result.current.revokeForm.authPayload).toBe("");
  });
});
