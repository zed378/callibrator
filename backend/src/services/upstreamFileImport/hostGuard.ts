/**
 * Which hosts the rsync image import may reach — the SSRF guard of a feature whose whole purpose
 * is an outbound connection the operator chose.
 *
 *  1. THE DPIA GATE (config/upstream#upstreamRealDataAllowed, docs/UPSTREAM/06-DPIA.md § 5).
 *     While it is off, only a source the operator declares synthetic AND whose host this
 *     deployment allow-lists (`RSYNC_ALLOWED_HOSTS`) may be used: a real upstream copy is
 *     refused before any packet is sent.
 *  2. INTERNAL ADDRESSES. The host is resolved and EVERY address checked (utils/ssrf.util#
 *     isBlockedIp: loopback, RFC 1918, link-local incl. the cloud metadata address, CGNAT,
 *     multicast, reserved); one internal address refuses the host unless it is allow-listed.
 *     `localhost`, `*.localhost` and `*.local` are refused the same way.
 *  3. NO REBINDING WINDOW. The answer is an ADDRESS, and that address is what ssh dials (the
 *     host key is pinned under a fixed alias, sshArgs.ts) — the name is never resolved again by
 *     ssh after this check.
 */
import dns from "dns";
import net from "net";
import { AppError } from "../../utils/appError.util";
import { isBlockedIp } from "../../utils/ssrf.util";
import { rsyncAllowedHosts, upstreamRealDataAllowed } from "../../config/upstream";

/** The resolved source. */
export interface ResolvedSource {
  /** The address ssh dials. */
  address: string;
  /** Whether the host passed only because it is allow-listed. */
  allowListed: boolean;
}

const LOCAL_NAME = /(^localhost$)|(\.localhost$)|(\.local$)/;

/** Refuse a source the DPIA gate does not allow (403: a policy of this deployment, not an input error). */
export const assertSourceAllowed = (host: string, syntheticSource: boolean): void => {
  if (upstreamRealDataAllowed()) {
    return;
  }
  if (!syntheticSource) {
    throw new AppError(
      403,
      "Importing real upstream data is disabled until the DPIA gates (R-01, R-03, R-17) are met " +
        "(UPSTREAM_REAL_DATA_ALLOWED=false). Only a synthetic test source on an allow-listed host may be used.",
    );
  }
  if (!rsyncAllowedHosts().includes(host.toLowerCase())) {
    throw new AppError(
      403,
      "While UPSTREAM_REAL_DATA_ALLOWED is false, a synthetic source must be on a host listed in RSYNC_ALLOWED_HOSTS.",
    );
  }
};

/**
 * Resolve `host` to the one address ssh will dial, refusing an internal one unless allow-listed.
 *
 * @throws AppError 400 — unresolvable, or internal and not allow-listed
 */
export const resolveSource = async (host: string): Promise<ResolvedSource> => {
  const lower = host.toLowerCase();
  const allowListed = rsyncAllowedHosts().includes(lower);
  if (LOCAL_NAME.test(lower) && !allowListed) {
    throw new AppError(400, "The host is a local name; add it to RSYNC_ALLOWED_HOSTS to use it");
  }
  let addresses: string[];
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await dns.promises.lookup(host, { all: true, verbatim: false })).map((a) => a.address);
    } catch {
      throw new AppError(400, "The host could not be resolved");
    }
  }
  const [first] = addresses;
  if (first === undefined) {
    throw new AppError(400, "The host could not be resolved");
  }
  if (!allowListed && addresses.some((address) => isBlockedIp(address))) {
    throw new AppError(
      400,
      "The host resolves to a private, loopback, link-local or reserved address; add it to RSYNC_ALLOWED_HOSTS to use it",
    );
  }
  return { address: first, allowListed };
};
