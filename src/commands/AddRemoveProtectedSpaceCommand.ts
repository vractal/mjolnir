/*
Copyright 2020-2021 The Matrix.org Foundation C.I.C.

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

import { Mjolnir } from "../Mjolnir";
import { extractRequestError, LogLevel, LogService } from "matrix-bot-sdk";

// !mjolnir rooms add <space alias/ID>
export async function execAddProtectedSpace(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const protectedSpaceId = await mjolnir.client.joinRoom(parts[3]);
    await mjolnir.addProtectedSpace(protectedSpaceId);
    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '✅');
}

// !mjolnir rooms remove <space alias/ID>
export async function execRemoveProtectedSpace(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const protectedSpaceId = await mjolnir.client.resolveRoom(parts[3]);
    await mjolnir.removeProtectedSpace(protectedSpaceId);
    try {
        await mjolnir.client.leaveRoom(protectedSpaceId);
    } catch (e) {
        LogService.warn("AddRemoveProtectedSpaceCommand", extractRequestError(e));
        await mjolnir.managementRoomOutput.logMessage(LogLevel.WARN, "AddRemoveProtectedSpaceCommand", `Failed to leave ${protectedSpaceId} - the room is no longer being protected, but the bot could not leave`, protectedSpaceId);
    }
    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '✅');
}
