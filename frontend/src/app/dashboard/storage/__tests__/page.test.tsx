/** @jest-environment jsdom */
/**
 * Storage (bring-your-own bucket), against the backend contract
 * (storage.controller.ts / storageSettings.service.js):
 *  - GET    /api/v1/storage/settings       → `data`: the safe view (never a secret)
 *  - GET    /api/v1/storage/usage          → `data: { bytes, objects, megabytes, provider }`
 *  - PUT    /api/v1/storage/settings       → probes first; 422 "Storage connection test failed: …"
 *  - DELETE /api/v1/storage/settings       → back to the platform default
 *  - POST   /api/v1/storage/settings/test  → `data: { ok, driver?, error? }`
 *
 * Real: the page, useStorageSettings, the storage service. Mocked: the
 * transport and the layout.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/components/layouts/DashboardLayout", () =>
  function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  },
);
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

import { api } from "@/api/client";
import StoragePage from "../page";
import { useToastStore } from "@/stores/toastStore";
import { httpError } from "@/tests/support/httpErrors";

// Whole-page renders with axe: allow for a loaded machine (as calibration/devices page tests do).
jest.setTimeout(20000);

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedPut = api.put as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const ok = (data: unknown) => ({ success: true, status: 200, message: "ok", data });
const platform = { provider: "default", usingPlatformDefault: true, hasCredentials: false };
const s3 = {
  provider: "s3",
  usingPlatformDefault: false,
  hasCredentials: true,
  bucket: "rs-harapan-files",
  region: "ap-southeast-1",
  endpoint: "https://minio.rs.test",
  forcePathStyle: true,
  prefix: "prod",
};
const usage = { bytes: 5_452_595, objects: 1, megabytes: 5.2, provider: "s3" };

let settings: unknown;
let usageAnswer: () => unknown;
beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  settings = ok(platform);
  usageAnswer = () => ok({ ...usage, provider: "local", objects: 3, megabytes: 12.34 });
  mockedGet.mockImplementation(async (url: string) => {
    if (url === "/api/v1/storage/settings") {
      if (settings instanceof Error) throw settings;
      return settings;
    }
    if (url === "/api/v1/storage/usage") return usageAnswer();
    throw new Error(`unexpected GET ${url}`);
  });
});

const toasts = () => useToastStore.getState().toasts;

describe("Storage page", () => {
  it("on the platform default: usage, the provider, and reset is not offered", async () => {
    const { container } = render(<StoragePage />);

    expect(await screen.findByText("12.3 MB")).toBeInTheDocument();
    expect(screen.getByText("3 objects")).toBeInTheDocument();
    expect(screen.getByText("Platform default")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reset to platform default/ })).toBeDisabled();
    expect(screen.getByLabelText(/Bucket/)).toHaveValue("");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a configured bucket fills the form — but never with a credential", async () => {
    settings = ok(s3);
    usageAnswer = () => ok(usage);
    render(<StoragePage />);

    await waitFor(() => expect(screen.getByLabelText(/Bucket/)).toHaveValue("rs-harapan-files"));
    expect(screen.getByText("S3")).toBeInTheDocument();
    expect(screen.getByText("1 object")).toBeInTheDocument();
    expect(screen.getByLabelText(/Region/)).toHaveValue("ap-southeast-1");
    expect(screen.getByLabelText(/Endpoint/)).toHaveValue("https://minio.rs.test");
    expect(screen.getByLabelText(/Path prefix/)).toHaveValue("prod");
    expect(screen.getByLabelText(/Access key ID/)).toHaveValue("");
    expect(screen.getByLabelText(/Secret access key/)).toHaveValue("");
    expect(screen.getByRole("button", { name: /Reset to platform default/ })).toBeEnabled();
  });

  it("an unreachable bucket's usage does not hide the settings", async () => {
    settings = ok(s3);
    usageAnswer = () => {
      throw httpError(500, "bucket unreachable");
    };
    render(<StoragePage />);

    expect(await screen.findByText("rs-harapan-files")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(toasts()).toEqual([]);
  });

  it("settings that cannot be read are reported", async () => {
    settings = httpError(403, "Forbidden");
    render(<StoragePage />);

    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ type: "error", title: "Failed to load storage settings" })]));
  });

  it("saves an S3 bucket with its credentials, and refreshes usage", async () => {
    mockedPut.mockResolvedValue(ok(s3));
    render(<StoragePage />);
    await screen.findByText("Platform default");

    fireEvent.change(screen.getByLabelText(/Bucket/), { target: { value: "rs-harapan-files" } });
    fireEvent.change(screen.getByLabelText(/Region/), { target: { value: "ap-southeast-1" } });
    fireEvent.change(screen.getByLabelText(/Endpoint/), { target: { value: "https://minio.rs.test" } });
    fireEvent.change(screen.getByLabelText(/Path prefix/), { target: { value: "prod" } });
    fireEvent.change(screen.getByLabelText(/Access key ID/), { target: { value: "AKIAEXAMPLE" } });
    fireEvent.change(screen.getByLabelText(/Secret access key/), { target: { value: "s3cr3t" } });
    const usageReads = mockedGet.mock.calls.filter(([u]) => u === "/api/v1/storage/usage").length;
    fireEvent.click(screen.getByRole("button", { name: /Verify & save/ }));

    await waitFor(() =>
      expect(mockedPut).toHaveBeenCalledWith("/api/v1/storage/settings", {
        provider: "s3",
        bucket: "rs-harapan-files",
        region: "ap-southeast-1",
        endpoint: "https://minio.rs.test",
        prefix: "prod",
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "s3cr3t",
      }),
    );
    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ type: "success", title: "Storage configured" })]));
    await waitFor(() =>
      expect(mockedGet.mock.calls.filter(([u]) => u === "/api/v1/storage/usage").length).toBe(usageReads + 1),
    );
    expect(await screen.findByText("S3")).toBeInTheDocument();
  });

  it("switching to NFS starts a fresh form and saves the mount root", async () => {
    mockedPut.mockResolvedValue(ok({ provider: "nfs", usingPlatformDefault: false, root: "/mnt/callibrator", fsync: true }));
    render(<StoragePage />);
    await screen.findByText("Platform default");

    fireEvent.change(screen.getByLabelText(/Bucket/), { target: { value: "left-behind" } });
    fireEvent.click(screen.getByRole("button", { name: /Provider/ }));
    fireEvent.click(screen.getByRole("option", { name: "NFS mount" }));
    expect(screen.queryByLabelText(/Bucket/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Mount root/), { target: { value: "/mnt/callibrator" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify & save/ }));

    await waitFor(() =>
      expect(mockedPut).toHaveBeenCalledWith("/api/v1/storage/settings", { provider: "nfs", root: "/mnt/callibrator" }),
    );
    expect(await screen.findByText("/mnt/callibrator", { selector: "span" })).toBeInTheDocument();
  });

  it("a bucket that fails the backend's probe (422) is not saved, and the reason is shown", async () => {
    mockedPut.mockRejectedValue(httpError(422, "Storage connection test failed: AccessDenied"));
    render(<StoragePage />);
    await screen.findByText("Platform default");

    fireEvent.change(screen.getByLabelText(/Bucket/), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify & save/ }));

    await waitFor(() =>
      expect(toasts()).toEqual([
        expect.objectContaining({
          type: "error",
          title: "Could not save storage settings",
          description: "Storage connection test failed: AccessDenied",
        }),
      ]),
    );
    expect(screen.getByText("Platform default")).toBeInTheDocument();
  });

  it("resets to the platform default", async () => {
    settings = ok(s3);
    usageAnswer = () => ok(usage);
    mockedDelete.mockResolvedValue(ok(platform));
    render(<StoragePage />);

    fireEvent.click(await screen.findByRole("button", { name: /Reset to platform default/ }));

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith("/api/v1/storage/settings"));
    expect(await screen.findByText("Platform default")).toBeInTheDocument();
    expect(toasts()).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Reverted to platform storage" })]));
  });

  it("a failed reset is reported", async () => {
    settings = ok(s3);
    usageAnswer = () => ok(usage);
    mockedDelete.mockRejectedValue(httpError(500, "Could not clear"));
    render(<StoragePage />);

    fireEvent.click(await screen.findByRole("button", { name: /Reset to platform default/ }));

    await waitFor(() =>
      expect(toasts()).toEqual([expect.objectContaining({ title: "Could not reset storage settings", description: "Could not clear" })]),
    );
  });

  it.each([
    [{ ok: true, driver: "s3" }, "success", "Storage reachable (s3)", undefined],
    [{ ok: true }, "success", "Storage reachable (ok)", undefined],
    [{ ok: false, error: "ENOTFOUND minio.rs.test" }, "error", "Storage unreachable", "ENOTFOUND minio.rs.test"],
  ])("the connection test reports %j", async (health, type, title, description) => {
    mockedPost.mockResolvedValue(ok(health));
    render(<StoragePage />);
    await screen.findByText("Platform default");

    fireEvent.click(screen.getByRole("button", { name: /Test connection/ }));

    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ type, title, description })]));
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/storage/settings/test", {});
  });

  it("a connection test that cannot run is reported", async () => {
    mockedPost.mockRejectedValue(httpError(403, "Forbidden"));
    render(<StoragePage />);
    await screen.findByText("Platform default");

    fireEvent.click(screen.getByRole("button", { name: /Test connection/ }));

    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ title: "Connection test failed", description: "Forbidden" })]));
  });
});
