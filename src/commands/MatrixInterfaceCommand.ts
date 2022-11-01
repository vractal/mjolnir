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

import { Mjolnir } from "../Mjolnir";
import { ApplicationCommand, ApplicationFeature, getApplicationFeature } from "./ApplicationCommand";

type CommandLookupEntry = Map<string|symbol, CommandLookupEntry|MatrixInterfaceCommand<BaseFunction>>;

type BaseFunction = (...args: any) => Promise<any>;
const FLATTENED_MATRIX_COMMANDS = new Set<MatrixInterfaceCommand<BaseFunction>>();
const THIS_COMMAND_SYMBOL = Symbol("thisCommand");

type ParserSignature<ExecutorType extends (...args: any) => Promise<any>> = (
    this: MatrixInterfaceCommand<ExecutorType>,
    mjolnir: Mjolnir,
    roomId: string,
    event: any,
    parts: string[]) => Promise<Parameters<ExecutorType>>;

type RendererSignature<ExecutorReturnType extends Promise<any>> = (
    mjolnir: Mjolnir,
    commandRoomId: string,
    event: any,
    result: Awaited<ExecutorReturnType>) => Promise<void>;

/**
 * Note, matrix interface command can be multi step ie ask for confirmation.
 * From the perspective here, confirmation should be a distinct thing that happens
 * before the interface command is invoked.
 *
 * When confirmation is required in the middle of a traditional command ie preview kick
 * the preview command should be a distinct command.
 */
class MatrixInterfaceCommand<ExecutorType extends (...args: any) => Promise<any>> {
    constructor(
        public readonly commandParts: string[],
        private readonly parser: ParserSignature<ExecutorType>,
        public readonly applicationCommand: ApplicationCommand<ExecutorType>,
        private readonly renderer: RendererSignature<ReturnType<ExecutorType>>
    ) {

    }

    public async invoke(...args: Parameters<ParserSignature<ExecutorType>>): Promise<void> {
        const parseResults = await this.parser(...args);
        const executorResult: ReturnType<ExecutorType> = await this.applicationCommand.executor.apply(this, parseResults);
        await this.renderer.apply(this, [...args.slice(0, -1), executorResult]);
    }
}

export function defineMatrixInterfaceCommand<ExecutorType extends (...args: any) => Promise<any>>(
        commandParts: string[],
        parser: ParserSignature<ExecutorType>,
        applicationCommmand: ApplicationCommand<ExecutorType>,
        renderer: RendererSignature<ReturnType<ExecutorType>>) {
    FLATTENED_MATRIX_COMMANDS.add(
        new MatrixInterfaceCommand(
            commandParts,
            parser,
            applicationCommmand,
            renderer
        )
    );
}


/**
 * This is used by mjolnirs.
 */
export class MatrixCommandTable {
    public readonly features: ApplicationFeature[];
    private readonly flattenedCommands: Set<MatrixInterfaceCommand<BaseFunction>>;
    private readonly commands: CommandLookupEntry = new Map();

    constructor(featureNames: string[]) {
        this.features = featureNames.map(name => {
            const feature = getApplicationFeature(name);
            if (feature) {
                return feature
            } else {
                throw new TypeError(`Couldn't find feature with name ${name}`)
            }
        });

        const commandHasFeatures = (command: ApplicationCommand<BaseFunction>) => {
            return command.requiredFeatures.every(feature => this.features.includes(feature))
        }
        this.flattenedCommands = new Set([...FLATTENED_MATRIX_COMMANDS].filter(interfaceCommand => commandHasFeatures(interfaceCommand.applicationCommand)));
        [...this.flattenedCommands].forEach(this.internCommand, this);
    }

    public findAMatchingCommand(parts: string[]) {
        const getCommand = (table: CommandLookupEntry): undefined|MatrixInterfaceCommand<BaseFunction> => {
            const command = table.get(THIS_COMMAND_SYMBOL);
            if (command instanceof Map) {
                throw new TypeError("There is an implementation bug, only commands should be stored under the command symbol");
            }
            return command;
        };
        const tableHelper = (table: CommandLookupEntry, nextParts: string[]): undefined|MatrixInterfaceCommand<BaseFunction> => {
            if (nextParts.length === 0) {
                // Then they might be using something like "!mjolnir status"
                return getCommand(table);
            }
            const entry = table.get(nextParts.shift()!);
            if (!entry) {
                // The reason there's no match is because this is the command arguments, rather than subcommand notation.
                return getCommand(table);
            } else {
                if (!(entry instanceof Map)) {
                    throw new TypeError("There is an implementation bug, only maps should be stored under arbirtrary keys");
                }
                return tableHelper(entry, nextParts);
            }
        };
        return tableHelper(this.commands, [...parts]);
    }

    private internCommand(command: MatrixInterfaceCommand<BaseFunction>) {
        const internCommandHelper = (table: CommandLookupEntry, commandParts: string[]): void => {
            if (commandParts.length === 0) {
                if (table.has(THIS_COMMAND_SYMBOL)) {
                    throw new TypeError(`There is already a command for ${JSON.stringify(commandParts)}`)
                }
                table.set(THIS_COMMAND_SYMBOL, command);
            } else {
                const nextTable = new Map();
                table.set(commandParts.shift()!, nextTable);
                internCommandHelper(nextTable, commandParts);
            }
        }

        internCommandHelper(this.commands, [...command.commandParts]);
    }
}
