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

// Standard library dependencies found in all official Civ7 dep files
const LIBRARY_DEPENDENCIES = [
  {
    libraryName: 'TiledMaterialLibrary',
    libraryHash: '3419754368',
    packageNames: ['Material'],
  },
  {
    libraryName: 'StandardAsset',
    libraryHash: '3471015496',
    packageNames: ['StandardAsset'],
  },
  {
    libraryName: 'ScriptLibrary',
    libraryHash: '219262143',
    packageNames: ['VFX', 'Script'],
  },
  {
    libraryName: 'UI',
    libraryHash: '2079568635',
    packageNames: ['UI', 'icons_standard', 'icons_antiquity', 'icons_exploration', 'UISlugs'],
  },
]

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
 * Includes the full LibraryDependencies block matching official Firaxis dep files.
 */
export function generateDep(modId: string): string {
  const id = escapeXml(modId)
  const uuid = randomUUID().toUpperCase()

  const libDeps = LIBRARY_DEPENDENCIES.map(lib => `\t\t<Element>
\t\t\t<LibraryName text="${lib.libraryName}"/>
\t\t\t<LibraryHash>${lib.libraryHash}</LibraryHash>
\t\t\t<PackageNames>
${lib.packageNames.map(p => `\t\t\t\t<Element text="${p}"/>`).join('\n')}
\t\t\t</PackageNames>
\t\t</Element>`).join('\n')

  return `<?xml version="1.0" encoding="UTF-8" ?>
<AssetObjects..GameDependencyData>
\t<ID>
\t\t<name text="${id}"/>
\t\t<id text="${uuid}"/>
\t</ID>
\t<RequiredGameArtIDs>
\t\t<Element>
\t\t\t<name text="Civ7"/>
\t\t\t<id text="${CIV7_ART_ID}"/>
\t\t</Element>
\t</RequiredGameArtIDs>
\t<LibraryDependencies>
${libDeps}
\t</LibraryDependencies>
</AssetObjects..GameDependencyData>
`
}
