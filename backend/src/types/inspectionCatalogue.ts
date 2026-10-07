/**
 * The content columns an inspection item definition holds and a template item copies (P20-03;
 * spec MEMORY/specs/P19-01-inspection-catalogue.md § 4.2, § 4.5). Shared by the two models
 * (`inspectionItemDefinition.model.ts`, `inspectionTemplateItem.model.ts`), which declare the
 * same attributes through `models/inspectionContent.ts`.
 *
 * Decimals are strings: Sequelize returns PostgreSQL NUMERIC as a string, and the catalogue
 * compares them as scaled integers, never as binary floats (spec § 6.1).
 */
import type {
  InspectionInputKind,
  InspectionLimitOp,
  InspectionOutcome,
  InspectionSection,
} from "@callibrator/contracts/inspectionValues";

/** One item's content: what is checked, how it is entered, and the limit it is held to. */
export interface InspectionContentAttributes {
  section: InspectionSection;
  label: string;
  inputKind: InspectionInputKind;
  unit: string | null;
  symbol: string | null;
  settingText: string | null;
  settingValue: string | null;
  limitOp: InspectionLimitOp | null;
  limitValue: string | null;
  limitLow: string | null;
  limitHigh: string | null;
  limitNominal: string | null;
  limitTolerance: string | null;
  limitText: string | null;
  validMin: string | null;
  validMax: string | null;
  warnMin: string | null;
  warnMax: string | null;
  allowedOutcomes: InspectionOutcome[];
}
