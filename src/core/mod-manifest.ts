/**
 * Mod manifest generator for Civilization VII
 *
 * Generates .modinfo and .dep XML files that follow the game's
 * mod structure conventions. These files allow the game to discover
 * and load art replacement mods placed in the DLC directory.
 */

import { randomUUID } from 'crypto'

// Well-known GUID for the base game art package
const CIV7_ART_ID = 'F5D94984-9531-46FF-92D9-3B65894F212B'

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Convert a folder name into a valid mod identifier.
 * Result is lowercase kebab-case, safe for XML and filenames.
 */
export function sanitizeModId(folderName: string): string {
  return folderName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'blp-studio-mod'
}

/**
 * Generate a .modinfo XML file for a Civ7 art replacement mod.
 */
export function generateModinfo(modId: string, modName: string): string {
  const id = escapeXml(modId)
  const name = escapeXml(modName)

  return `<?xml version="1.0" encoding="utf-8"?>
<Mod id="${id}" version="1" xmlns="ModInfo">
    <Properties>
        <Name>${name}</Name>
        <Description>Asset replacements exported by BLP Studio</Description>
        <Authors>BLP Studio</Authors>
        <EnabledByDefault>1</EnabledByDefault>
        <Package>${id}</Package>
    </Properties>
    <Dependencies>
        <Mod id="base-standard" title="LOC_MODULE_BASE_STANDARD_NAME"/>
    </Dependencies>
    <ActionCriteria>
        <Criteria id="always"><AlwaysMet/></Criteria>
    </ActionCriteria>
    <ActionGroups>
        <ActionGroup id="${id}-game" scope="game" criteria="always">
            <Actions>
                <UpdateArt><Item>${id}</Item></UpdateArt>
            </Actions>
        </ActionGroup>
        <ActionGroup id="${id}-shell" scope="shell" criteria="always">
            <Actions>
                <UpdateArt><Item>${id}</Item></UpdateArt>
            </Actions>
        </ActionGroup>
    </ActionGroups>
</Mod>
`
}

/**
 * Generate a .dep (GameDependencyData) XML file for a Civ7 art replacement mod.
 */
export function generateDep(modId: string): string {
  const id = escapeXml(modId)
  const uuid = randomUUID().toUpperCase()

  return `<?xml version="1.0" encoding="UTF-8" ?>
<AssetObjects..GameDependencyData>
    <ID>
        <name text="${id}"/>
        <id text="${uuid}"/>
    </ID>
    <RequiredGameArtIDs>
        <Element>
            <name text="Civ7"/>
            <id text="${CIV7_ART_ID}"/>
        </Element>
    </RequiredGameArtIDs>
</AssetObjects..GameDependencyData>
`
}
