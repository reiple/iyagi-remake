import type { Profile } from "../core/profiles";

export function setupProfiles(save: (profiles: Profile[]) => Promise<Profile>, update: (profile: Profile) => void) {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const dialog = get<HTMLDialogElement>("profiles-dialog");
  const picker = get<HTMLSelectElement>("profile-select");
  const label = get<HTMLInputElement>("profile-label");
  const host = get<HTMLInputElement>("host");
  const port = get<HTMLInputElement>("port");
  const encoding = get<HTMLSelectElement>("encoding");
  const error = get("profiles-message");
  let profiles: Profile[] = [];
  let current = 0;
  function capture() {
    profiles[current] = { name: label.value.trim(), host: host.value.trim(), port: port.valueAsNumber, encoding: encoding.value as Profile["encoding"] };
  }
  function show(index: number) {
    current = index;
    picker.replaceChildren(...profiles.map((profile, i) => new Option(profile.name || "새 프로필", String(i))));
    picker.selectedIndex = index;
    const profile = profiles[index];
    label.value = profile.name;
    host.value = profile.host;
    port.value = Number.isNaN(profile.port) ? "" : String(profile.port);
    encoding.value = profile.encoding;
    get<HTMLButtonElement>("profile-remove").disabled = profiles.length === 1;
    get<HTMLButtonElement>("profile-add").disabled = profiles.length === 30;
    error.textContent = "";
  }
  picker.onchange = () => { const index = picker.selectedIndex; capture(); show(index); };
  get("profile-add").onclick = () => {
    capture();
    profiles.push({ name: "", host: "", port: 6666, encoding: "cp949" });
    show(profiles.length - 1);
    label.focus();
  };
  get("profile-remove").onclick = () => {
    profiles.splice(current, 1);
    show(Math.min(current, profiles.length - 1));
  };
  get("profiles-close").onclick = () => dialog.close();
  get<HTMLFormElement>("profiles-form").onsubmit = async (event) => {
    event.preventDefault();
    capture();
    const button = get<HTMLButtonElement>("profiles-save");
    button.disabled = true;
    try {
      update(await save(profiles));
      dialog.close();
    } catch (e) {
      error.textContent = String(e);
    } finally {
      button.disabled = false;
    }
  };
  return (saved: Profile[]) => {
    if (dialog.open || document.querySelector("dialog[open]")) return;
    profiles = saved.map((profile) => ({ ...profile }));
    show(0);
    dialog.showModal();
  };
}
