import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type CharacterRecord = {
  id: string;
  name: string;
  password: string;
  fileName: string;
};
type StoredRecord = Omit<CharacterRecord, "password"> & { secret: string };

export class CharacterStore {
  private key: Buffer;
  private file: string;
  constructor(public directory: string) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = path.join(directory, "characters.json");
    const keyPath = path.join(directory, "credential.key");
    if (!fs.existsSync(keyPath)) {
      if (fs.existsSync(this.file))
        throw Error(
          "저장된 캐릭터의 암호화 키가 없습니다. 데이터 볼륨을 확인하세요.",
        );
      fs.writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: "wx" });
    }
    this.key = fs.readFileSync(keyPath);
    if (this.key.length !== 32) throw Error("암호화 키가 손상되었습니다.");
  }
  load(): CharacterRecord[] {
    if (!fs.existsSync(this.file)) return [];
    const records: StoredRecord[] = JSON.parse(
      fs.readFileSync(this.file, "utf8"),
    );
    if (!Array.isArray(records) || records.length > 100)
      throw Error("캐릭터 저장 파일이 올바르지 않습니다.");
    const ids = new Set<string>();
    const names = new Set<string>();
    return records.map((record) => {
      if (
        !record ||
        !/^[a-f0-9-]{36}$/.test(record.id) ||
        typeof record.name !== "string" ||
        !record.name ||
        typeof record.secret !== "string" ||
        typeof record.fileName !== "string" ||
        ids.has(record.id) ||
        names.has(record.name)
      )
        throw Error("캐릭터 저장 파일이 올바르지 않습니다.");
      ids.add(record.id);
      names.add(record.name);
      const bytes = Buffer.from(record.secret, "base64");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        bytes.subarray(0, 12),
      );
      decipher.setAAD(Buffer.from(record.id));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const password = Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
      return {
        id: record.id,
        name: record.name,
        fileName: record.fileName,
        password,
      };
    });
  }
  save(records: CharacterRecord[]) {
    const stored = records.map(({ password, ...record }) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.key, iv);
      cipher.setAAD(Buffer.from(record.id));
      const ciphertext = Buffer.concat([
        cipher.update(password, "utf8"),
        cipher.final(),
      ]);
      return {
        ...record,
        secret: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
          "base64",
        ),
      };
    });
    fs.writeFileSync(this.file + ".tmp", JSON.stringify(stored, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(this.file + ".tmp", this.file);
  }
}
