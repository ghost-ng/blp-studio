/**
 * Civilization VII BLP Type Registry
 *
 * Self-describing type system parsed from the TypeInfoStripe embedded
 * in each BLP package. Provides reflection metadata for deserialization.
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface BLPField {
  name: string;
  typeName: string;
  version: number;
  address: number;
}

export interface BLPEnumConstant {
  name: string;
  value: number;
}

export interface BLPEnum {
  name: string;
  constants: BLPEnumConstant[];
  version: number;
}

export interface BLPType {
  name: string;
  underlyingName: string;
  fields: BLPField[];
  version: number;
  size: number;
  traitFlags: number;
  isFundamental: boolean;
  isPointer: boolean;
  isArray: boolean;
  isPolymorphic: boolean;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class TypeRegistry {
  public readonly types: Map<string, BLPType> = new Map();
  public readonly enums: Map<string, BLPEnum> = new Map();

  addType(t: BLPType): void {
    this.types.set(t.name, t);
  }

  addEnum(e: BLPEnum): void {
    this.enums.set(e.name, e);
  }

  get(name: string): BLPType | undefined {
    return this.types.get(name);
  }
}
