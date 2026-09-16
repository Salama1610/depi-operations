export type ServiceLinkAutoStatus = "Needs Review" | "Failed";

export type ServiceLinkVerification = {
  status: ServiceLinkAutoStatus;
  normalizedUrl: string;
  platform: string;
  serviceId: string | null;
  checks: string[];
  message: string;
  verificationVersion: string;
};

export const serviceLinkVerificationVersion = "2026-09-16.1";
export const acceptedServicePlatforms = ["Kafiil", "Khamsat"] as const;
const platformHosts: Record<string, string> = {
  "kafiil.com": "Kafiil",
  "khamsat.com": "Khamsat",
};
const slug = "[\\p{L}\\p{N}]+(?:-[\\p{L}\\p{N}]+)*";
const kafiilPath = new RegExp(`^/service/(\\d+)-(${slug})/?$`, "iu");
const khamsatPath = new RegExp(`^/(${slug})/(${slug})/(\\d+)-(${slug})/?$`, "iu");

function hostPlatform(hostname: string) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return platformHosts[host] || "External service";
}

function marketplacePath(platform: string, pathname: string) {
  let decodedPath = pathname;
  try { decodedPath = decodeURIComponent(pathname); } catch {}
  const match = platform === "Kafiil"
    ? decodedPath.match(kafiilPath)
    : platform === "Khamsat"
      ? decodedPath.match(khamsatPath)
      : null;
  return { valid: Boolean(match), serviceId: match?.[platform === "Kafiil" ? 1 : 3] || null };
}

function failed(message: string, checks: string[] = [message]): ServiceLinkVerification {
  return {
    status: "Failed",
    normalizedUrl: "",
    platform: "Unknown",
    serviceId: null,
    checks,
    message,
    verificationVersion: serviceLinkVerificationVersion,
  };
}

/**
 * The automatic gate is deterministic and network-free. It accepts only direct,
 * secure Kafiil and Khamsat service-page URLs. QC remains responsible for page
 * availability, ownership, category and track fit.
 */
export function verifyServiceLink(raw: unknown): ServiceLinkVerification {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return failed("Add a public service link.");
  if (value.length > 2048)
    return failed("Use a direct service URL shorter than 2,048 characters.");
  try {
    const parsed = new URL(value);
    const protocolOk = parsed.protocol === "https:";
    const directOk = !parsed.username && !parsed.password && !parsed.port;
    const platform = hostPlatform(parsed.hostname);
    const platformOk = acceptedServicePlatforms.includes(platform as any);
    const path = marketplacePath(platform, parsed.pathname);
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    parsed.hash = "";
    parsed.search = "";
    const checks = [
      protocolOk ? "Secure HTTPS link" : "The service link must use HTTPS",
      directOk ? "Direct public URL" : "Ports and embedded credentials are not allowed",
      platformOk ? `${platform} is accepted` : "Only Kafiil and Khamsat service links are accepted",
      path.valid
        ? `Numeric service ID ${path.serviceId} and slug detected`
        : "Use the complete service URL with its numeric ID and Arabic or English slug",
    ];
    const isFailed = !protocolOk || !directOk || !platformOk || !path.valid;
    return {
      status: isFailed ? "Failed" : "Needs Review",
      normalizedUrl: parsed.toString(),
      platform,
      serviceId: path.serviceId,
      checks,
      message: isFailed
        ? checks.find((check) => /must|not allowed|Only|complete/.test(check)) || "Fix the link before QC review."
        : "Format verified. QC still confirms availability, ownership, category and track fit.",
      verificationVersion: serviceLinkVerificationVersion,
    };
  } catch {
    return failed("Enter a complete HTTPS service URL.", ["Valid URL format required"]);
  }
}

export function normalizeServiceSlots(input: unknown) {
  if (!Array.isArray(input) || input.length !== 3)
    throw new Error("Submit exactly 3 service links.");
  const values = input.map((value) =>
    typeof value === "string" ? value.trim() : "",
  );
  if (values.some((value) => !value))
    throw new Error("All 3 service links are required.");
  const normalized = values.map((value) =>
    verifyServiceLink(value).normalizedUrl || value.toLowerCase(),
  );
  if (new Set(normalized).size !== 3)
    throw new Error("Each service link must be different.");
  return values;
}
