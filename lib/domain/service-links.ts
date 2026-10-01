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
export function verifyServiceLink(raw: unknown, options: { open?: boolean } = {}): ServiceLinkVerification {
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
    // An open link is any secure, direct page on another site. It has no
    // marketplace shape to check; QC confirms it is the student's service.
    if (options.open && !platformOk) {
      const openFailed = parsed.protocol !== "https:" || !directOk || !/\./.test(parsed.hostname);
      const openChecks = [
        parsed.protocol === "https:" ? "Secure HTTPS link" : "The service link must use HTTPS",
        directOk ? "Direct public URL" : "Ports and embedded credentials are not allowed",
        "Open link on another site",
      ];
      return {
        status: openFailed ? "Failed" : "Needs Review",
        normalizedUrl: parsed.toString(),
        upgraded: false,
        platform,
        serviceId: null,
        checks: openChecks,
        message: openFailed
          ? openChecks.find((check) => /must|not allowed/.test(check)) || "Fix the link before QC review."
          : "Open link accepted. QC confirms the page is your service.",
        verificationVersion: serviceLinkVerificationVersion,
      };
    }
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

/** A student's services are complete at this many links... */
export const minServiceLinks = 3;
/**
 * ...as long as at least this many of them are on these marketplaces: one on
 * each, or two on either. Any two Kafiil or Nafezly services satisfy it.
 */
export const requiredServicePlatforms = ["Kafiil", "Nafezly"] as const;
export const minRequiredPlatformLinks = 2;
/** No more than this many on any one of the accepted marketplaces. */
export const maxLinksPerPlatform = 3;
/** And never more than this many links in all. */
export const maxServiceLinks = 9;
/** The platform recorded for a link on any other site. */
export const openLinkPlatform = "External service";

/**
 * What makes two links the same service: the marketplace and its numeric
 * service ID, so a renamed slug is still the same one. An open link has no
 * service ID and is compared by its address.
 */
export function serviceKey(check: Pick<ServiceLinkVerification, "platform" | "serviceId"> & { normalizedUrl?: string }) {
  if (check.serviceId) return `${check.platform}:${check.serviceId}`;
  return check.normalizedUrl ? `url:${check.normalizedUrl}` : null;
}

/** How many links are on each accepted marketplace, and how many are open links. */
export function linksPerPlatform(values: string[]) {
  const counts: Record<string, number> = Object.fromEntries(
    [...acceptedServicePlatforms, openLinkPlatform].map((p) => [p, 0]),
  );
  for (const value of values) {
    const platform = verifyServiceLink(value, { open: true }).platform;
    if (platform in counts) counts[platform] += 1;
  }
  return counts;
}

/**
 * Where a student stands: links submitted against the minimum, and how many
 * are on Kafiil or Nafezly against the two required there (one on each, or two
 * on either). `platforms` is one entry per link the student holds.
 */
export function serviceProgress(platforms: string[]) {
  const required = platforms.filter((p) => (requiredServicePlatforms as readonly string[]).includes(p)).length;
  const needed = Math.max(0, minRequiredPlatformLinks - required);
  return {
    count: platforms.length,
    minimum: minServiceLinks,
    kafiilOrNafezly: required,
    requiredMinimum: minRequiredPlatformLinks,
    /** Kafiil or Nafezly services still to add. */
    needed,
    met: platforms.length >= minServiceLinks && needed === 0,
  };
}

/**
 * The links a student holds once a submission is applied, in slot order. They
 * are checked as a set: at most three on each marketplace, nine in all, room
 * left for a required Kafiil and Nafezly service, and no service twice.
 * Fewer than three is allowed; services are submitted one at a time.
 */
export function normalizeServiceSlots(input: unknown) {
  if (!Array.isArray(input) || input.length === 0) throw new Error("Add a service link.");
  if (input.length > maxServiceLinks) throw new Error(`Submit at most ${maxServiceLinks} service links.`);
  const values = input.map((value) => (typeof value === "string" ? value.trim() : ""));
  if (values.some((value) => !value)) throw new Error("Fill in every service link you added, or remove it.");
  const counts = linksPerPlatform(values);
  for (const platform of acceptedServicePlatforms)
    if (counts[platform] > maxLinksPerPlatform)
      throw new Error(`At most ${maxLinksPerPlatform} ${platform} links can be submitted; this has ${counts[platform]}.`);
  const platforms = values.map((value) => verifyServiceLink(value, { open: true }).platform);
  const needed = serviceProgress(platforms).needed;
  if (values.length + needed > maxServiceLinks)
    throw new Error(`Keep room for ${needed} more Kafiil or Nafezly service${needed === 1 ? "" : "s"}: ${maxServiceLinks} links at most.`);
  const identity = values.map((value) => {
    const check = verifyServiceLink(value, { open: true });
    return serviceKey(check) || value.toLowerCase();
  });
  if (new Set(identity).size !== values.length) throw new Error("Each service link must be different.");
  return values;
}
