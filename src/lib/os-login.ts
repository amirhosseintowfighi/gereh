/** the administrator login of an OS image: Windows templates use Administrator (with the password set at creation or
    reinstall), everything else root */
export const isWindows = (os: string | null | undefined) => /windows/i.test(os ?? "");
export const loginUser = (os: string | null | undefined) => (isWindows(os) ? "Administrator" : "root");
/** how the customer reaches the server: RDP for Windows, SSH otherwise */
export const remoteAccess = (os: string | null | undefined) => (isWindows(os) ? "RDP (پورت 3389)" : "SSH (پورت 22)");
