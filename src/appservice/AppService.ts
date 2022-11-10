/*
Copyright 2022 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { AppServiceRegistration, Bridge, Request, WeakEvent, BridgeContext, MatrixUser } from "matrix-appservice-bridge";
import { MjolnirManager } from ".//MjolnirManager";
import { DataStore, PgDataStore } from ".//datastore";
import { Api } from "./Api";
import { IConfig } from "./config/config";
import { AccessControl } from "./AccessControl";

/**
 * Responsible for setting up listeners and delegating functionality to a matrix-appservice-bridge `Bridge` for
 * the entrypoint of the application.
 */
export class MjolnirAppService {

    private readonly api: Api;

    /**
     * The constructor is private because we want to ensure intialization steps are followed,
     * use `makeMjolnirAppService`.
     */
    private constructor(
        public readonly config: IConfig,
        public readonly bridge: Bridge,
        private readonly mjolnirManager: MjolnirManager,
        private readonly accessControl: AccessControl,
        private readonly dataStore: DataStore,
    ) {
        this.api = new Api(config.homeserver.url, mjolnirManager);
    }

    /**
     * Make and initialize the app service from the config, ready to be started.
     * @param config The appservice's config, not mjolnir's, see `src/appservice/config`.
     * @param dataStore A datastore to persist infomration about the mjolniren to.
     * @param registrationFilePath A file path to the registration file to read the namespace and tokens from.
     * @returns A new `MjolnirAppService`.
     */
    public static async makeMjolnirAppService(config: IConfig, dataStore: DataStore, registrationFilePath: string) {
        const bridge = new Bridge({
            homeserverUrl: config.homeserver.url,
            domain: config.homeserver.domain,
            registration: registrationFilePath,
            // We lazily initialize the controller to avoid null checks
            // It also allows us to combine constructor/initialize logic
            // to make the code base much simpler. A small hack to pay for an overall less hacky code base.
            controller: {
                onUserQuery: () => {throw new Error("Mjolnir uninitialized")},
                onEvent: () => {throw new Error("Mjolnir uninitialized")},
            },
            suppressEcho: false,
        });
        await bridge.initalise();
        const accessControlListId = await bridge.getBot().getClient().resolveRoom(config.accessControlList);
        const accessControl = await AccessControl.setupAccessControl(accessControlListId, bridge);
        const mjolnirManager = await MjolnirManager.makeMjolnirManager(dataStore, bridge, accessControl);
        const appService = new MjolnirAppService(
            config,
            bridge,
            mjolnirManager,
            accessControl,
            dataStore
        );
        bridge.opts.controller = {
            onUserQuery: appService.onUserQuery.bind(appService),
            onEvent: appService.onEvent.bind(appService),
        };
        return appService;
    }

    /**
     * Start the appservice for the end user with the appropriate settings from their config and registration file.
     * @param port The port to make the appservice listen for transactions from the homeserver on (usually sourced from the cli).
     * @param config The parsed configuration file.
     * @param registrationFilePath A path to their homeserver registration file.
     */
     public static async run(port: number, config: IConfig, registrationFilePath: string) {
        const dataStore = new PgDataStore(config.db.connectionString);
        await dataStore.init();
        const service = await MjolnirAppService.makeMjolnirAppService(config, dataStore, registrationFilePath);
        // Can't stress how important it is that listen happens last.
        await service.start(port);
    }

    public onUserQuery (queriedUser: MatrixUser) {
        return {}; // auto-provision users with no additonal data
    }

    /**
     * Handle an individual event pushed by the homeserver to us.
     * This function is async (and anything downstream would be anyway), which does mean that events can be processed out of order.
     * Not a huge problem for us, but is something to be aware of.
     * @param request A matrix-appservice-bridge request encapsulating a Matrix event.
     * @param context Additional context for the Matrix event.
     */
    public async onEvent(request: Request<WeakEvent>, context: BridgeContext) {
        const mxEvent = request.getData();
        if ('m.room.member' === mxEvent.type) {
            if ('invite' === mxEvent.content['membership'] && mxEvent.state_key === this.bridge.botUserId) {
                await this.mjolnirManager.provisionNewMjolnir(mxEvent.sender);
            }
        }
        this.accessControl.handleEvent(mxEvent['room_id'], mxEvent);
        this.mjolnirManager.onEvent(request, context);
    }

    /**
     * Start the appservice. See `run`.
     * @param port The port that the appservice should listen on to receive transactions from the homeserver.
     */
    private async start(port: number) {
        console.log("Starting MjolnirAppService, Matrix-side to listen on port %s", port);
        this.api.start(this.config.webAPI.port);
        await this.bridge.listen(port);
        console.log("MjolnirAppService started successfully");
    }

    /**
     * Stop listening to requests from both the homeserver and web api and disconnect from the datastore.
     */
    public async close(): Promise<void> {
        await this.bridge.close();
        await this.dataStore.close();
        await this.api.close();
    }

    public static generateRegistration(reg: AppServiceRegistration, callback: (finalRegisration: AppServiceRegistration) => void) {
        reg.setId(AppServiceRegistration.generateToken());
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart("mjolnir-bot");
        reg.addRegexPattern("users", "@mjolnir_.*", true);
        reg.setRateLimited(false);
        callback(reg);
    }
}
