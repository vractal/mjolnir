/**
 * This file is used to launch mjolnir for manual testing, creating a user and management room automatically if it doesn't already exist.
 */

import { makeMjolnir } from "./mjolnirSetupUtils";
import { read as configRead } from '../../src/config';
import { initializeSentry } from "../../src/utils";

(async () => {
    const config = configRead();
    // Initialize error monitoring as early as possible.
    initializeSentry(config);
    let mjolnir = await makeMjolnir(config);
    await mjolnir.start();
})();
