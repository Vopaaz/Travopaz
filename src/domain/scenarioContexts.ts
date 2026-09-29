import type { OptionBlock } from './schema';

export type Scenario = Readonly<Record<string, string>>;

/** Track the scenarios producing each result, without exposing unrelated choices. */
export class ScenarioContexts {
  private occurrences = new Map<object, Map<string, string[]>>();

  constructor(private options: OptionBlock[]) {}

  record(result: object, scenario: Scenario) {
    const choices = this.options.map((option) => scenario[option.id] ?? '');
    const rows = this.occurrences.get(result) ?? new Map<string, string[]>();
    rows.set(JSON.stringify(choices), choices);
    this.occurrences.set(result, rows);
  }

  describe(results: object[]): string[] {
    const rows = new Map<string, string[]>();
    for (const result of results)
      for (const [key, choices] of this.occurrences.get(result) ?? []) rows.set(key, choices);
    if (!rows.size) return [];

    // A choice is irrelevant only if every choice of that Option yields this result
    // for every observed combination of the other Options. Checking projections
    // preserves dependencies such as (A1 AND B1) OR (A2 AND B2).
    const relevant = this.options.flatMap((option, index) => {
      if (option.variants.length <= 1) return [];
      const others = new Set(
        [...rows.values()].map((choices) => JSON.stringify(choices.filter((_, i) => i !== index))),
      );
      return others.size * option.variants.length === rows.size ? [] : [index];
    });
    if (!relevant.length) return [];

    const projected = new Map<string, string[]>();
    for (const choices of rows.values()) {
      const selected = relevant.map((index) => choices[index]);
      projected.set(JSON.stringify(selected), selected);
    }
    return [...projected.values()].map((selected) =>
      relevant
        .map((index, i) => {
          const option = this.options[index];
          const variant = option.variants.find((v) => v.id === selected[i])!;
          return `${option.title} · ${variant.title}`;
        })
        .join(' / '),
    );
  }
}
