window.__ModuleLoader__.load({
	id: "deepseek-autoreview",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region src/settings-shared.ts
		/** Settings namespace owning the reviewer route preference. */
		const REVIEW_SETTINGS_NAMESPACE = "autoreview";
		/** Composition entry: follow the main conversation route. */
		const DEFAULT_REVIEW_SETTINGS = {
			route: "session",
			provider: "",
			model: ""
		};
		//#endregion
		//#region src/client/ReviewRow.ts
		/**
		* The General-settings row for the reviewer route preference: follow the main
		* conversation model, or pin a provider/model pair (validated host-side with
		* catalog fallback). Writes travel through the settings-scope transport; the
		* host re-judges the route on the next ask, no restart required.
		*/
		/** Read the settings scope reactively. */
		function useReviewSettings(host) {
			return react.default.useSyncExternalStore((onStoreChange) => host.subscribe(onStoreChange), () => host.getSnapshot().value ?? DEFAULT_REVIEW_SETTINGS);
		}
		/** Render the compact reviewer-route row. */
		function ReviewRow(props) {
			const { host } = props;
			const settings = useReviewSettings(host);
			const setField = (field, value) => {
				host.set(field, value);
			};
			const labelStyle = {
				fontSize: 12,
				color: "var(--dsw-text-secondary, #888)",
				marginTop: 6
			};
			const inputStyle = {
				padding: "6px 8px",
				fontSize: 13,
				border: "1px solid var(--dsw-border, #ccc)",
				borderRadius: 6,
				background: "var(--dsw-surface, transparent)",
				color: "var(--dsw-text, inherit)"
			};
			const inputs = settings.route === "fixed" ? [
				react.default.createElement("label", {
					key: "pl",
					style: labelStyle
				}, "Provider"),
				react.default.createElement("input", {
					key: "pi",
					value: settings.provider,
					placeholder: "deepseek-official",
					style: inputStyle,
					onChange: (event) => {
						setField("provider", event.target.value);
					}
				}),
				react.default.createElement("label", {
					key: "ml",
					style: labelStyle
				}, "Model"),
				react.default.createElement("input", {
					key: "mi",
					value: settings.model,
					placeholder: "deepseek-v4-flash",
					style: inputStyle,
					onChange: (event) => {
						setField("model", event.target.value);
					}
				}),
				react.default.createElement("div", {
					key: "hint",
					style: {
						fontSize: 11,
						color: "var(--dsw-text-tertiary, #aaa)",
						marginTop: 4
					}
				}, "例如 deepseek-official / deepseek-v4-flash")
			] : [];
			return react.default.createElement("div", { style: {
				padding: "12px 16px",
				display: "flex",
				flexDirection: "column",
				gap: 6
			} }, react.default.createElement("div", { style: {
				fontSize: 13,
				fontWeight: 600
			} }, "替我审核模型 · Auto-review model"), react.default.createElement("select", {
				value: settings.route,
				style: inputStyle,
				onChange: (event) => {
					setField("route", event.target.value);
				}
			}, react.default.createElement("option", { value: "session" }, "跟随主会话 · Follow main conversation"), react.default.createElement("option", { value: "fixed" }, "指定模型 · Fixed model")), ...inputs);
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* Browser half of deepseek-autoreview: the General-settings row switching the
		* reviewer model route at runtime (follow the main conversation, or pin a
		* provider/model pair). Settings travel through the settings-scope transport;
		* the host re-judges the route on the next ask without a restart.
		*/
		/**
		* Compose the settings row: bind the settings scope and contribute the
		* compact row to the General section.
		* @param ctx - client cordis context.
		*/
		function apply(ctx) {
			const host = ctx.settingsScope.bind({ namespace: REVIEW_SETTINGS_NAMESPACE });
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "autoreview",
				order: 30
			}, (props) => react.default.createElement(ReviewRow, {
				...props,
				host
			})));
		}
		//#endregion
		exports.apply = apply;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map