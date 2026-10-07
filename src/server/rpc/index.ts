import "server-only";
import type { Method } from "../ctx";
import { accountRpc } from "./account";
import { adminRpc } from "./admin";
import { authRpc } from "./auth";
import { billingRpc } from "./billing";
import { blogRpc } from "./blog";
import { chatRpc } from "./chat";
import { serversRpc } from "./servers";
import { servicesRpc } from "./services";
import { supportRpc } from "./support";
import { teamRpc } from "./team";

/** every callable method, keyed "group.name" exactly like the client's api.group.name */
export const registry: Record<string, Method> = { ...authRpc, ...serversRpc, ...servicesRpc, ...billingRpc, ...supportRpc, ...accountRpc, ...adminRpc, ...teamRpc, ...chatRpc, ...blogRpc };
