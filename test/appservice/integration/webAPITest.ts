import { MjolnirAppService } from "../../../src/appservice/AppService";
import { newTestUser } from "../../integration/clientHelper";
import { isPolicyRoom, readTestConfig, setupHarness } from "../utils/harness";
import { CreateMjolnirResponse, MjolnirWebAPIClient } from "../utils/webAPIClient";
import { MatrixClient } from "matrix-bot-sdk";
import { getFirstReply } from "../../integration/commands/commandUtils";
import expect from "expect";


interface Context extends Mocha.Context {
    appservice?: MjolnirAppService
    user?: MatrixClient
}


describe("Test that the app service can provision a mjolnir when requested from the web API", function () {
    afterEach(function(this: Context) {
        this.user?.stop();
        if (this.appservice) {
            return this.appservice.close();
        } else {
            console.warn("Missing Appservice in this context, so cannot stop it.")
        }
    });
    it("", async function (this: Context) {
        const config = readTestConfig();
        this.appservice = await setupHarness();
        // create a user
        const user = await newTestUser(config.homeserver.url, { name: { contains: "test" } });
        const apiClient = await MjolnirWebAPIClient.makeClient(user, "http://localhost:9001");
        const roomToProtectId = await user.createRoom({ preset: "public_chat" });

        this.user = user;
        const roomsInvitedTo: string[] = [];
        const mjolnirDetails: CreateMjolnirResponse = await new Promise(async resolve => {
            const mjolnirDetailsPromise = apiClient.createMjolnir(roomToProtectId);
            user.on('room.invite', (roomId: string) => {
                roomsInvitedTo.push(roomId)
                // the appservice should invite it to a policy room and a management room.
                if (roomsInvitedTo.length === 2) {
                    mjolnirDetailsPromise.then(resolve);
                }
            });
            await user.start();
        });
        await Promise.all(roomsInvitedTo.map(roomId => user.joinRoom(roomId)));
        const managementRoomId = roomsInvitedTo.filter(async roomId => !(await isPolicyRoom(user, roomId)))[0];
        expect(managementRoomId).toBe(mjolnirDetails.managementRoomId);
        const event = await getFirstReply(user, managementRoomId, () => {
            return user.sendMessage(managementRoomId, { body: `!mjolnir status`, msgtype: 'm.text' });
        })
        expect(event.sender).toBe(mjolnirDetails.mjolnirUserId);
    })
})
