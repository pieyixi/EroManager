import { describe, expect, it, vi } from "vitest";
import { ehApi } from "../api/commands/eh";
import { createPinia, setActivePinia } from "pinia";
import {
  buildEhSpreads,
  type EhReaderPage,
  useEhReaderStore,
} from "./ehReader";
const portrait = (index: number): EhReaderPage => ({
  index,
  path: String(index),
  width: 1000,
  height: 1500,
});
const landscape = (index: number): EhReaderPage => ({
  index,
  path: String(index),
  width: 1600,
  height: 1000,
});
describe("Eh reader spread matching", () => {
  it("keeps the cover single and pairs following portrait pages", () => {
    const spreads = buildEhSpreads(
      [portrait(0), portrait(1), portrait(2), portrait(3)],
      "double",
      1,
    );
    expect(
      spreads.map((spread) => spread.pages.map((page) => page.index)),
    ).toEqual([[0], [1, 2], [3]]);
  });
  it("keeps landscape pages single without losing adjacent pages", () => {
    const spreads = buildEhSpreads(
      [portrait(0), portrait(1), landscape(2), portrait(3), portrait(4)],
      "double",
      0,
    );
    expect(
      spreads.map((spread) => spread.pages.map((page) => page.index)),
    ).toEqual([[0, 1], [2], [3, 4]]);
  });
  it("uses one page per spread in single mode", () => {
    expect(
      buildEhSpreads([portrait(0), portrait(1)], "single", 0),
    ).toHaveLength(2);
  });
});

describe("Eh reader page-turn direction", () => {
  it("ignores a late page list from a previously opened work", async () => {
    setActivePinia(createPinia());
    const reader = useEhReaderStore();
    let finishOld!: (pages: EhReaderPage[]) => void;
    const getPages = vi.spyOn(ehApi, 'getPages')
      .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockResolvedValueOnce([portrait(5)]);
    vi.spyOn(reader, 'loadSpreadImages').mockResolvedValue();
    vi.spyOn(reader, 'prefetchNearby').mockResolvedValue();
    try {
      const old = reader.open({ gid: 1 } as Parameters<typeof reader.open>[0]);
      await reader.open({ gid: 2 } as Parameters<typeof reader.open>[0]);
      finishOld([landscape(0)]);
      await old;
      expect(reader.gallery?.gid).toBe(2);
      expect(reader.pages.map(page => page.index)).toEqual([5]);
      expect(reader.loading).toBe(false);
    } finally { getPages.mockRestore(); }
  });

  it("starts from path-only page metadata and records dimensions lazily", () => {
    setActivePinia(createPinia());
    const reader = useEhReaderStore();
    reader.pages = [
      { index: 0, path: "0", width: 0, height: 0 },
      { index: 1, path: "1", width: 0, height: 0 },
      { index: 2, path: "2", width: 0, height: 0 },
    ];
    reader.pairOffset = 0;

    expect(reader.spreads.map((spread) => spread.pages.map((page) => page.index))).toEqual([[0, 1], [2]]);
    reader.recordPageDimensions(0, 1600, 900);
    expect(reader.spreads.map((spread) => spread.pages.map((page) => page.index))).toEqual([[0], [1, 2]]);
    expect(reader.spreadIndex).toBe(0);
  });

  it("advances from right to left in Japanese manga mode", () => {
    setActivePinia(createPinia());
    const reader = useEhReaderStore();
    reader.pages = [portrait(0), portrait(1), portrait(2), portrait(3)];
    reader.direction = "rtl";

    reader.turnLeft();
    expect(reader.spreadIndex).toBe(1);
    reader.turnRight();
    expect(reader.spreadIndex).toBe(0);
  });

  it("advances from left to right in normal mode", () => {
    setActivePinia(createPinia());
    const reader = useEhReaderStore();
    reader.pages = [portrait(0), portrait(1), portrait(2), portrait(3)];
    reader.direction = "ltr";

    reader.turnRight();
    expect(reader.spreadIndex).toBe(1);
    reader.turnLeft();
    expect(reader.spreadIndex).toBe(0);
  });

  it("merges only the current two-page spread", () => {
    setActivePinia(createPinia());
    const reader = useEhReaderStore();
    reader.pages = [portrait(0), portrait(1), portrait(2), portrait(3)];

    expect(reader.currentPairMerged).toBe(false);
    reader.toggleCurrentPairMerge();
    expect(reader.currentPairMerged).toBe(false);

    reader.next();
    reader.toggleCurrentPairMerge();
    expect(reader.currentPairMerged).toBe(true);
    reader.next();
    expect(reader.currentPairMerged).toBe(false);
  });
});
