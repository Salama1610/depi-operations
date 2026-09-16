export type ServiceLinkAutoStatus = "Verified" | "Needs Review" | "Failed";

export type ServiceLinkVerification = {
  status: ServiceLinkAutoStatus;
  normalizedUrl: string;
  platform: string;
  checks: string[];
  message: string;
};

const platformHosts: Record<string, string> = {
  "kafiil.com": "Kafiil",
  "khamsat.com": "Khamsat",
  "upwork.com": "Upwork",
  "freelancer.com": "Freelancer",
  "fiverr.com": "Fiverr",
  "mostaql.com": "Mostaql",
  "linkedin.com": "LinkedIn",
  "behance.net": "Behance",
  "dribbble.com": "Dribbble",
  "github.com": "GitHub",
};

function hostPlatform(hostname: string) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  const entry = Object.entries(platformHosts).find(
    ([domain]) => host === domain || host.endsWith(`.${domain}`),
  );
  return entry?.[1] || "External service";
}

function marketplacePathCheck(platform: string, parsed: URL) {
  if (platform === "Kafiil") return /^\/service\/\d+(?:-|\/|$)/i.test(parsed.pathname);
  if (platform === "Khamsat") return /^\/[^/]+\/[^/]+\/\d+(?:-|\/|$)/i.test(parsed.pathname);
  return true;
}

/**
 * Automatic verification intentionally stays deterministic and network-free for now.
 * The later link rules can be plugged into this function without changing the API or UI.
 */
export function verifyServiceLink(raw: unknown): ServiceLinkVerification {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    return {
      status: "Failed",
      normalizedUrl: "",
      platform: "Unknown",
      checks: ["A link is required"],
      message: "Add a public service link.",
    };
  }
  try {
    const parsed = new URL(value);
    const protocolOk = parsed.protocol === "https:" || parsed.protocol === "http:";
    const hostOk = Boolean(parsed.hostname) && !parsed.hostname.includes(" ");
    const platform = hostPlatform(parsed.hostname);
    const pathOk = parsed.pathname.length > 1 || parsed.search.length > 1;
    const marketplacePathOk = marketplacePathCheck(platform, parsed);
    const normalizedUrl = parsed.toString();
    const checks = [
      protocolOk ? "HTTP/HTTPS link" : "Only HTTP or HTTPS links are supported",
      hostOk ? "Public hostname" : "A valid hostname is required",
      marketplacePathOk
        ? "Service page pattern detected"
        : "Marketplace service URL pattern is invalid",
    ];
    const failed =
      !protocolOk ||
      !hostOk ||
      !pathOk ||
      !marketplacePathOk ||
      Boolean(parsed.username || parsed.password);
    return {
      status: failed ? "Failed" : "Needs Review",
      normalizedUrl,
      platform,
      checks,
      message: failed
        ? "Fix the link format before QC review."
        : "Link format passed; QC still needs to confirm the service.",
    };
  } catch {
    return {
      status: "Failed",
      normalizedUrl: "",
      platform: "Unknown",
      checks: ["Valid URL format required"],
      message: "Enter a complete link beginning with https:// or http://.",
    };
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
  const normalized = values.map((value) => verifyServiceLink(value).normalizedUrl || value.toLowerCase());
  if (new Set(normalized).size !== 3)
    throw new Error("Each service link must be different.");
  return values;
}
