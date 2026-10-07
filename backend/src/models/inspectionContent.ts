/**
 * The content attributes an inspection item definition holds and a template item copies
 * (P20-03; spec MEMORY/specs/P19-01-inspection-catalogue.md § 4.2, § 4.5) — declared once, so the
 * library and the frozen copies cannot drift. Migration 0112 creates the same columns
 * (`contentColumns`; tests/migrations/0112 holds the two equal) and every CHECK on them: none is
 * declared here (sync() never creates one, ADR-100 Am. 3).
 */
import type { DataTypes as DataTypesNamespace, ModelAttributeColumnOptions } from "sequelize";
import {
  INSPECTION_INPUT_KINDS,
  INSPECTION_LIMIT_OPS,
  INSPECTION_OUTCOMES,
  INSPECTION_SECTIONS,
} from "@callibrator/contracts/inspectionValues";
import type { InspectionContentAttributes } from "../types/inspectionCatalogue";

/** The § 4.2 content attributes, camelCase over snake_case columns (`underscored: true`). */
export const inspectionContentAttributes = (
  DataTypes: typeof DataTypesNamespace,
): Record<keyof InspectionContentAttributes, ModelAttributeColumnOptions> => {
  const decimal = (): ModelAttributeColumnOptions => ({ type: DataTypes.DECIMAL, allowNull: true });
  return {
    section: { type: DataTypes.ENUM(...INSPECTION_SECTIONS), allowNull: false },
    label: { type: DataTypes.STRING(255), allowNull: false },
    inputKind: { type: DataTypes.ENUM(...INSPECTION_INPUT_KINDS), allowNull: false },
    unit: { type: DataTypes.STRING(20), allowNull: true },
    symbol: { type: DataTypes.STRING(50), allowNull: true },
    settingText: { type: DataTypes.STRING(50), allowNull: true },
    settingValue: decimal(),
    limitOp: { type: DataTypes.ENUM(...INSPECTION_LIMIT_OPS), allowNull: true },
    limitValue: decimal(),
    limitLow: decimal(),
    limitHigh: decimal(),
    limitNominal: decimal(),
    limitTolerance: decimal(),
    limitText: { type: DataTypes.STRING(100), allowNull: true },
    validMin: decimal(),
    validMax: decimal(),
    warnMin: decimal(),
    warnMax: decimal(),
    allowedOutcomes: { type: DataTypes.ARRAY(DataTypes.ENUM(...INSPECTION_OUTCOMES)), allowNull: false },
  };
};
