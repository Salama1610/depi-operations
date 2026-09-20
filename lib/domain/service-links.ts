export type ServiceLinkAutoStatus = "Needs Review" | "Failed";

export type ServiceLinkVerification = {
  status: ServiceLinkAutoStatus;
  normalizedUrl: string;
  /** True when an http address on an approved marketplace was raised to https. */
  upgraded: boolean;
  platform: string;
  serviceId: string | null;
  checks: string[];
  message: string;
  verificationVersion: string;
};

export const serviceLinkVerificationVersion = "2026-09-20.1";
export const acceptedServicePlatforms = ["Kafiil", "Khamsat", "Nafezly"] as const;
const platformHosts: Record<string, string> = {
  "kafiil.com": "Kafiil",
  "khamsat.com": "Khamsat",
  "nafezly.com": "Nafezly",
};
const slug = "[\\p{L}\\p{N}]+(?:-[\\p{L}\\p{N}]+)*";
const servicePath = new RegExp(`^/service/(\\d+)-(${slug})/?$`, "iu");
const categoryPath = new RegExp(`^/(${slug})/(${slug})/(\\d+)-(${slug})/?$`, "iu");

/**
 * Each accepted marketplace publishes its services under one address shape.
 * `idGroup` is the capture holding the numeric service ID.
 */
const platformPaths: Record<string, { pattern: RegExp; idGroup: number }> = {
  Kafiil: { pattern: servicePath, idGroup: 1 },
  Nafezly: { pattern: servicePath, idGroup: 1 },
  Khamsat: { pattern: categoryPath, idGroup: 3 },
};

/** "Kafiil, Khamsat and Nafezly" — used in the student-facing messages. */
function acceptedPlatformList() {
  const names = [...acceptedServicePlatforms];
  return names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

function hostPlatform(hostname: string) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return platformHosts[host] || "External service";
}

function marketplacePath(platform: string, pathname: string) {
  let decodedPath = pathname;
  try { decodedPath = decodeURIComponent(pathname); } catch {}
  const shape = platformPaths[platform];
  const match = shape ? decodedPath.match(shape.pattern) : null;
  return { valid: Boolean(match), serviceId: (shape && match?.[shape.idGroup]) || null };
}

function failed(message: string, checks: string[] = [message]): ServiceLinkVerification {
  return {
    status: "Failed",
    normalizedUrl: "",
    upgraded: false,
    platform: "Unknown",
    serviceId: null,
    checks,
    message,
    verificationVersion: serviceLinkVerificationVersion,
  };
}

/**
 * The automatic gate is deterministic and network-free. It accepts only direct
 * service pages on the approved marketplaces (see acceptedServicePlatforms) and
 * stores them over https. QC remains responsible for page availability,
 * ownership, category and track fit.
 */
export function verifyServiceLink(raw: unknown): ServiceLinkVerification {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return failed("Add a public service link.");
  if (value.length > 2048)
    return failed("Use a direct service URL shorter than 2,048 characters.");
  try {
    const parsed = new URL(value);
    const directOk = !parsed.username && !parsed.password && !parsed.port;
    const platform = hostPlatform(parsed.hostname);
    const platformOk = acceptedServicePlatforms.includes(platform as any);
    const path = marketplacePath(platform, parsed.pathname);
    // Students commonly copy an http address for a marketplace that serves the
    // same page over https. For an accepted marketplace the scheme is upgraded
    // and the secure address is what gets stored; anything else must already be
    // https, so no insecure link is ever recorded.
    const upgraded = parsed.protocol === "http:" && platformOk && path.valid;
    const protocolOk = parsed.protocol === "https:" || upgraded;
    if (upgraded) parsed.protocol = "https:";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    parsed.hash = "";
    parsed.search = "";
    const checks = [
      upgraded
        ? "Secure HTTPS link (the address was upgraded from http)"
        : protocolOk
          ? "Secure HTTPS link"
          : "The service link must use HTTPS",
      directOk ? "Direct public URL" : "Ports and embedded credentials are not allowed",
      platformOk ? `${platform} is accepted` : `Only ${acceptedPlatformList()} service links are accepted`,
      path.valid
        ? `Numeric service ID ${path.serviceId} and slug detected`
        : "Use the complete service URL with its numeric ID and Arabic or English slug",
    ];
    const isFailed = !protocolOk || !directOk || !platformOk || !path.valid;
    return {
      status: isFailed ? "Failed" : "Needs Review",
      normalizedUrl: parsed.toString(),
      upgraded,
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
