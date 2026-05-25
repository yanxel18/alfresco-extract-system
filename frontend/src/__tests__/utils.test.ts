import { formatBytes, formatDate } from "@/utils";

describe("utils", () => {
  describe("formatBytes", () => {
    it("formats zero bytes", () => {
      expect(formatBytes(0)).toBe("0 B");
    });

    it("formats bytes across units", () => {
      expect(formatBytes(512)).toBe("512 B");
      expect(formatBytes(1024)).toBe("1 KB");
      expect(formatBytes(1536)).toBe("1.5 KB");
      expect(formatBytes(5 * 1024 * 1024, 2)).toBe("5 MB");
      expect(formatBytes(3 * 1024 * 1024 * 1024, 2)).toBe("3 GB");
    });
  });

  describe("formatDate", () => {
    const RealDate = Date;

    afterEach(() => {
      globalThis.Date = RealDate;
    });

    it("returns a placeholder for missing values", () => {
      expect(formatDate()).toBe("—");
    });

    it("appends Z when the timestamp has no timezone", () => {
      const captured: unknown[] = [];
      class MockDate extends RealDate {
        constructor(value?: string | number | Date) {
          super(value as ConstructorParameters<typeof RealDate>[0]);
          captured.push(value);
        }

        override toLocaleString() {
          return "formatted-no-zone";
        }
      }
      globalThis.Date = MockDate as unknown as DateConstructor;

      expect(formatDate("2024-01-02T03:04:05")).toBe("formatted-no-zone");
      expect(captured[captured.length - 1]).toBe("2024-01-02T03:04:05Z");
    });

    it("preserves explicit timezone markers", () => {
      const captured: unknown[] = [];
      class MockDate extends RealDate {
        constructor(value?: string | number | Date) {
          super(value as ConstructorParameters<typeof RealDate>[0]);
          captured.push(value);
        }

        override toLocaleString() {
          return "formatted-zoned";
        }
      }
      globalThis.Date = MockDate as unknown as DateConstructor;

      expect(formatDate("2024-01-02T03:04:05Z")).toBe("formatted-zoned");
      expect(captured[captured.length - 1]).toBe("2024-01-02T03:04:05Z");

      expect(formatDate("2024-01-02T03:04:05+09:00")).toBe("formatted-zoned");
      expect(captured[captured.length - 1]).toBe("2024-01-02T03:04:05+09:00");
    });
  });
});
