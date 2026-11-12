import type { Settings } from "./settings";

export type Profile = Pick<Settings, "host" | "port" | "encoding"> & {
  name: string;
};

export function validateProfiles(value: unknown): Profile[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 30)
    throw Error("접속 프로필은 1개부터 30개까지 저장할 수 있습니다.");
  const names = new Set<string>();
  return value.map((profile) => {
    const { name, host, port, encoding } = profile ?? {};
    if (typeof name !== "string" || !name.trim() || name.length > 60 || /[\x00-\x1f]/.test(name) || names.has(name.trim()))
      throw Error("프로필 이름은 비어 있거나 중복될 수 없습니다.");
    if (typeof host !== "string" || !host.trim() || host.length > 253 || /[\s/\\]/.test(host.trim()) ||
        !Number.isInteger(port) || port < 1 || port > 65535 || !["cp949", "utf8"].includes(encoding))
      throw Error("서버 주소, 포트 또는 인코딩이 올바르지 않습니다.");
    names.add(name.trim());
    return { name: name.trim(), host: host.trim(), port, encoding };
  });
}
