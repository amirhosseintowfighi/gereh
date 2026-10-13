import "server-only";
import type { Method } from "../ctx";
import { accountRpc } from "./account";
import { adminRpc } from "./admin";
import { authRpc } from "./auth";
import { billingRpc } from "./billing";
import { blogRpc } from "./blog";
import { chatRpc } from "./chat";
import { devopsRpc } from "./devops";
import { domainsRpc } from "./domains";
import { geoMethods } from "./geo";
import { aiMethods } from "./ai";
import { aiPlusMethods } from "./ai-plus";
import { inquiryMethods } from "./inquiry";
import { mailRpc } from "./mail";
import { paasRpc } from "./paas";
import { dbaasRpc } from "./dbaas";
import { paasRuntimeRpc } from "./paas-runtime";
import { wordpressRpc } from "./wordpress";
import { notifyRpc } from "./notify";
import { serversRpc } from "./servers";
import { servicesRpc } from "./services";
import { storageRpc } from "./storage";
import { supportRpc } from "./support";
import { teamRpc } from "./team";

/** every callable method, keyed "group.name" exactly like the client's api.group.name */
export const registry: Record<string, Method> = { ...authRpc, ...serversRpc, ...servicesRpc, ...domainsRpc, ...billingRpc, ...supportRpc, ...accountRpc, ...adminRpc, ...teamRpc, ...chatRpc, ...blogRpc, ...devopsRpc, ...paasRpc, ...dbaasRpc, ...paasRuntimeRpc, ...inquiryMethods, ...geoMethods, ...aiMethods, ...aiPlusMethods, ...wordpressRpc, ...notifyRpc, ...storageRpc, ...mailRpc };
