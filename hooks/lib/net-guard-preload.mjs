// Loaded with node --import (workers/read-page.mjs sets it in NODE_OPTIONS for defuddle): every connection the
// process makes is checked by net-guard.mjs before it reaches a private or local address
import { guardConnections } from "./net-guard.mjs";

guardConnections();
