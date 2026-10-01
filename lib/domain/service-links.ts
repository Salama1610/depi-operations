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
    // An open link is any secure, direct page on another site, for the
    // optional "Other" section. It has no marketplace shape to check; QC
    // confirms it is the student's service.
    if (options.open && !platformOk) {
      const openFailed = parsed.protocol !== "https:" || !directOk || !/\./.test(parsed.hostname);
      const openChecks = [
        parsed.protocol === "https:" ? "Secure HTTPS link" : "The service link must use HTTPS",
        directOk ? "Direct public URL" : "Ports and embedded credentials are not allowed",
        "Link on another site",
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
          : "Link accepted. QC confirms the page is your service.",
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

/**
 * A student's services come in three sections. Kafiil and Nafezly are the
 * required ones: at least three links between them, in any mix (three on one,
 * or two and one). "Other" holds links on any other site, Khamsat included;
 * it is optional and does not count toward the three.
 */
export const requiredServicePlatforms = ["Kafiil", "Nafezly"] as const;
export const serviceCategories = ["Nafezly", "Kafiil", "Other"] as const;
export type ServiceCategory = (typeof serviceCategories)[number];
/** Kafiil and Nafezly links needed, between them, to submit. */
export const minServiceLinks = 3;
/** No more than this many links in any one section. */
export const maxLinksPerPlatform = 3;
/** And so never more than this many links in all. */
export const maxServiceLinks = serviceCategories.length * maxLinksPerPlatform;
/** The platform recorded for a link on a site that is not a marketplace. */
export const openLinkPlatform = "External service";

/** The section a link belongs to, from the platform its address is on. */
export function serviceCategory(platform: string): ServiceCategory {
  return platform === "Kafiil" || platform === "Nafezly" ? platform : "Other";
}

/**
 * What makes two links the same service: the marketplace and its numeric
 * service ID, so a renamed slug is still the same one. A link without a
 * service ID is compared by its address.
 */
export function serviceKey(check: Pick<ServiceLinkVerification, "platform" | "serviceId"> & { normalizedUrl?: string }) {
  if (check.serviceId) return `${check.platform}:${check.serviceId}`;
  return check.normalizedUrl ? `url:${check.normalizedUrl}` : null;
}

/** How many links are in each section. */
export function linksPerCategory(values: string[]) {
  const counts = Object.fromEntries(serviceCategories.map((c) => [c, 0])) as Record<ServiceCategory, number>;
  for (const value of values) counts[serviceCategory(verifyServiceLink(value, { open: true }).platform)] += 1;
  return counts;
}

/**
 * Where a student stands: Kafiil and Nafezly links against the three needed,
 * and how many are in each section. `platforms` is one entry per link.
 */
export function serviceProgress(platforms: string[]) {
  const perCategory = Object.fromEntries(serviceCategories.map((c) => [c, 0])) as Record<ServiceCategory, number>;
  for (const platform of platforms) perCategory[serviceCategory(platform)] += 1;
  const required = perCategory.Kafiil + perCategory.Nafezly;
  return {
    count: platforms.length,
    required,
    minimum: minServiceLinks,
    perCategory,
    met: required >= minServiceLinks,
  };
}

/**
 * The links a student holds once a submission is applied, in slot order,
 * checked as a set: at least three on Kafiil and Nafezly between them, at most
 * three in each section, and no service twice.
 */
export function normalizeServiceSlots(input: unknown) {
  if (!Array.isArray(input) || input.length === 0) throw new Error("Add your service links.");
  if (input.length > maxServiceLinks) throw new Error(`Submit at most ${maxServiceLinks} service links.`);
  const values = input.map((value) => (typeof value === "string" ? value.trim() : ""));
  if (values.some((value) => !value)) throw new Error("Fill in every service link you added, or remove it.");
  const counts = linksPerCategory(values);
  for (const category of serviceCategories)
    if (counts[category] > maxLinksPerPlatform)
      throw new Error(`At most ${maxLinksPerPlatform} ${category} links can be submitted; this has ${counts[category]}.`);
  if (counts.Kafiil + counts.Nafezly < minServiceLinks)
    throw new Error(`Add at least ${minServiceLinks} Kafiil or Nafezly links, in any mix. Links on other sites do not count toward them.`);
  const identity = values.map((value) => {
    const check = verifyServiceLink(value, { open: true });
    return serviceKey(check) || value.toLowerCase();
  });
  if (new Set(identity).size !== values.length) throw new Error("Each service link must be different.");
  return values;
}
