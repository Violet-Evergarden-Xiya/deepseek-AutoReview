//#region lib/types/invariant.js
/**
* Package-owned verdict-stream invariant for the model-backed reviewer.
* @module deepseek-autoreview/invariant
*/
const PACKAGE_NAME = "deepseek-autoreview";
const DECISIONS = [
	"allow",
	"refer",
	"deny"
];
/** Cordis companion plugin name. */
const name = "autoreview-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
const install = Object.assign((ctx, fail) => {
	ctx.on("session/event", (_session, event) => {
		if (event.type !== "review/verdict") return;
		if (event.data.toolName.length === 0) fail("review/verdict toolName must be non-empty");
		if (!DECISIONS.includes(event.data.decision)) fail(`review/verdict carries unknown decision ${JSON.stringify(event.data.decision)}`);
	}, { global: true });
}, { inject: ["sessions"] });
/**
* Register the reviewer invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
