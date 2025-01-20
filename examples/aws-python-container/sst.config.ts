/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
	app(input) {
		return {
			name: "aws-python-container",
			removal: input?.stage === "production" ? "retain" : "remove",
			home: "aws",
			providers: {
				aws: true,
			},
		};
	},
	async run() {
		const linkableValue = new sst.Linkable("MyLinkableValue", {
			properties: {
				foo: "Hello World",
			},
		});

		const base = new sst.aws.Function("PythonFn", {
			python: {
				container: true,
			},
			handler: "./functions/src/functions/api.handler",
			runtime: "python3.11",
			url: true,
			link: [linkableValue],
		});

		const custom = new sst.aws.Function("PythonFnCustom", {
			python: {
				container: true,
			},
			handler: "./custom_dockerfile/src/custom_dockerfile/api.handler",
			runtime: "python3.11",
			url: true,
			link: [linkableValue],
		});

		return {
			base: base.url,
			custom: custom.url,
		};
	},
});
