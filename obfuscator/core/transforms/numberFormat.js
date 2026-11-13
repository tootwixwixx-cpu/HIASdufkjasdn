// core/transforms/numberFormat.js
// Formats numeric literals into exact Luraph v14-style binary and hex formats
// Examples from Luraph: 0B1000001, 0B100__000, 0B10000, 0X8, 0X4, 0B10__, 0X1, 0x001,
// 0B11, 0B1_, 0X6, 0x5, 0X7_, 0XC, 0Xf, 0B11000, 0B10111_, 0X17, 0X01, 0X06e, 0X5D49, 0B11101, 0X382__7

'use strict';

/**
 * Converts an integer into a Luraph-style hex or binary literal.
 * Luau supports underscores anywhere in number literals (even trailing like 0B1_ or 0X7_).
 */
function toLuraphNumber(n, forceFormat = null) {
  if (typeof n !== 'number' || Number.isNaN(n) || !Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 0xFFFFFFF) {
    if (typeof n === 'number' && Number.isNaN(n)) return '0';
    return String(n);
  }

  // Handle 0
  if (n === 0) {
    const zeroVariants = ['0', '0X0', '0B0', '(0B0)', '(0X0)', '0x00'];
    return zeroVariants[Math.floor(Math.random() * zeroVariants.length)];
  }

  const format = forceFormat || (Math.random() < 0.55 ? 'bin' : (Math.random() < 0.85 ? 'hex' : 'dec'));

  if (format === 'bin' && n <= 512) {
    let bin = n.toString(2);
    const prefix = Math.random() > 0.5 ? '0B' : '0b';

    // Random styling: underscores in middle or end, or parentheses
    const style = Math.random();
    if (bin.length >= 3 && style < 0.35) {
      const splitAt = Math.floor(bin.length / 2);
      const sep = Math.random() > 0.6 ? '__' : '_';
      bin = bin.slice(0, splitAt) + sep + bin.slice(splitAt);
    } else if (style < 0.55) {
      // Trailing underscore: e.g. 0B1_ or 0B10__
      bin = bin + (Math.random() > 0.6 ? '__' : '_');
    }

    const res = `${prefix}${bin}`;
    return Math.random() < 0.25 ? `(${res})` : res;
  }

  if (format === 'hex' || (format === 'bin' && n > 512)) {
    let hex = n.toString(16);
    // Random upper/lower case hex letters (e.g. 0X06e or 0XC or 0Xf)
    if (Math.random() > 0.4) {
      hex = hex.toUpperCase();
    } else {
      hex = hex.toLowerCase();
    }

    const prefix = Math.random() > 0.5 ? '0X' : '0x';

    // Optional leading zero padding like 0x001 or 0X01 or 0X06e
    if (Math.random() < 0.3 && hex.length <= 2) {
      hex = '0' + hex;
    }

    const style = Math.random();
    if (hex.length >= 3 && style < 0.4) {
      const splitAt = Math.floor(hex.length / 2);
      const sep = Math.random() > 0.6 ? '__' : '_';
      hex = hex.slice(0, splitAt) + sep + hex.slice(splitAt);
    } else if (style < 0.6) {
      // Trailing underscore: e.g. 0X7_
      hex = hex + (Math.random() > 0.6 ? '__' : '_');
    }

    const res = `${prefix}${hex}`;
    return Math.random() < 0.2 ? `(${res})` : res;
  }

  // Plain decimal, sometimes wrapped in parentheses
  return Math.random() < 0.2 ? `(${n})` : String(n);
}

module.exports = { toLuraphNumber };
