/**
 * P10-02: fills `{name}` placeholders. A placeholder with no value is left as
 * written, so a missing argument is visible in review rather than silently "".
 */
export const format = (template: string, values?: Readonly<Record<string, string | number>>): string =>
  values
    ? template.replace(/\{(\w+)\}/g, (whole, name: string) =>
        Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole,
      )
    : template;
