/** All pack addresses are assigned before document construction. Exporters can supply another package. */
export const WORLD_DESTINATION = Object.freeze({package: "world", prefix: "bcc"});
export function packAddress(source, suffix, destination = WORLD_DESTINATION) {
  const clean = x => String(x).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const packName = `${clean(destination.prefix)}-${clean(source)}-${suffix}`;
  return {packName, packId: `${destination.package}.${packName}`, package: destination.package};
}
