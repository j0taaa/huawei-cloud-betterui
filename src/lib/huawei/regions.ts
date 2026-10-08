/** Huawei names regional subprojects <region>_<name>; the project name stays intact. */
export function projectRegion(projectName: string, regionId?: string) {
  return regionId || projectName.split("_", 1)[0];
}
