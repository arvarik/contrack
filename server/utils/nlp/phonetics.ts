// =============================================================================
// Double Metaphone
// =============================================================================

export function doubleMetaphone(input: string): { primary: string; alternate: string } {
  if (!input) return { primary: "", alternate: "" };

  const MAX_LEN = 4;
  const word = input.toUpperCase().replace(/[^A-Z]/g, "") + "     "; // pad for safe lookahead
  const len = word.length - 5; // true length without padding
  if (len < 1) return { primary: "", alternate: "" };

  let primary = "";
  let alternate = "";
  let pos = 0;

  const at = (i: number) => word[i] ?? "";
  const sliceAt = (i: number, n: number) => word.slice(i, i + n);
  const isVowel = (c: string) => "AEIOUY".includes(c);

  const addBoth = (p: string, a?: string) => {
    primary += p;
    alternate += a ?? p;
  };

  if (["GN", "KN", "PN", "AE", "WR"].includes(sliceAt(0, 2))) {
    pos = 1;
  }

  if (at(0) === "X") {
    addBoth("S");
    pos = 1;
  }

  while (pos < len && (primary.length < MAX_LEN || alternate.length < MAX_LEN)) {
    const c = at(pos);
    if (c === at(pos - 1) && c !== "C") { pos++; continue; }

    switch (c) {
      case "A": case "E": case "I": case "O": case "U": case "Y":
        if (pos === 0) addBoth("A");
        pos++;
        break;
      case "B":
        addBoth("P");
        pos += (at(pos + 1) === "B") ? 2 : 1;
        break;
      case "C":
        if (sliceAt(pos, 2) === "CH") {
          addBoth("X");
          pos += 2;
        } else if (sliceAt(pos, 2) === "CK") {
          addBoth("K");
          pos += 2;
        } else if ("IEY".includes(at(pos + 1))) {
          addBoth("S");
          pos += 2;
        } else {
          addBoth("K");
          pos += (sliceAt(pos, 2) === "CZ" || (sliceAt(pos, 2) === "CC" && pos + 2 < len)) ? 2 : 1;
        }
        break;
      case "D":
        if (sliceAt(pos, 2) === "DG" && "IEY".includes(at(pos + 2))) {
          addBoth("J"); pos += 3;
        } else {
          addBoth("T");
          pos += (sliceAt(pos, 2) === "DT" || sliceAt(pos, 2) === "DD") ? 2 : 1;
        }
        break;
      case "F":
        addBoth("F");
        pos += (at(pos + 1) === "F") ? 2 : 1;
        break;
      case "G":
        if (at(pos + 1) === "H") {
          if (pos > 0 && !isVowel(at(pos - 1))) {
            addBoth("K"); pos += 2;
          } else if (pos === 0) {
            addBoth("K"); pos += 2;
          } else {
            pos += 2;
          }
        } else if (at(pos + 1) === "N") {
          if (pos === 0) { addBoth("KN", "N"); pos += 2; }
          else { addBoth("N"); pos += 2; }
        } else if ("IEY".includes(at(pos + 1))) {
          addBoth("J", "K");
          pos += 2;
        } else {
          addBoth("K");
          pos += (at(pos + 1) === "G") ? 2 : 1;
        }
        break;
      case "H":
        if (isVowel(at(pos + 1)) && (pos === 0 || !isVowel(at(pos - 1)))) {
          addBoth("H"); pos += 2;
        } else { pos++; }
        break;
      case "J":
        addBoth("J", "A");
        pos += (at(pos + 1) === "J") ? 2 : 1;
        break;
      case "K":
        addBoth("K");
        pos += (at(pos + 1) === "K") ? 2 : 1;
        break;
      case "L":
        addBoth("L");
        pos += (at(pos + 1) === "L") ? 2 : 1;
        break;
      case "M":
        addBoth("M");
        pos += (at(pos + 1) === "M") ? 2 : 1;
        break;
      case "N":
        addBoth("N");
        pos += (at(pos + 1) === "N") ? 2 : 1;
        break;
      case "P":
        if (at(pos + 1) === "H") {
          addBoth("F"); pos += 2;
        } else {
          addBoth("P");
          pos += (at(pos + 1) === "P") ? 2 : 1;
        }
        break;
      case "Q":
        addBoth("K");
        pos += (at(pos + 1) === "Q") ? 2 : 1;
        break;
      case "R":
        addBoth("R");
        pos += (at(pos + 1) === "R") ? 2 : 1;
        break;
      case "S":
        if (sliceAt(pos, 2) === "SH") {
          addBoth("X"); pos += 2;
        } else if (sliceAt(pos, 3) === "SCH") {
          addBoth("SK"); pos += 3;
        } else if (sliceAt(pos, 2) === "SZ") {
          addBoth("S", "X"); pos += 2;
        } else if ("IEY".includes(at(pos + 1))) {
          addBoth("S"); pos += 2;
        } else {
          addBoth("S");
          pos += (at(pos + 1) === "S") ? 2 : 1;
        }
        break;
      case "T":
        if (sliceAt(pos, 2) === "TH" || sliceAt(pos, 3) === "TCH") {
          addBoth("0");
          pos += (sliceAt(pos, 3) === "TCH") ? 3 : 2;
        } else if (sliceAt(pos, 4) === "TION" || sliceAt(pos, 4) === "TIAL") {
          addBoth("X"); pos += 3;
        } else {
          addBoth("T");
          pos += (at(pos + 1) === "T" || at(pos + 1) === "D") ? 2 : 1;
        }
        break;
      case "V":
        addBoth("F");
        pos += (at(pos + 1) === "V") ? 2 : 1;
        break;
      case "W":
        if (isVowel(at(pos + 1))) {
          addBoth("A"); pos += 2;
        } else if (sliceAt(pos, 2) === "WR") {
          addBoth("R"); pos += 2;
        } else { pos++; }
        break;
      case "X":
        addBoth("KS");
        pos += (at(pos + 1) === "X") ? 2 : 1;
        break;
      case "Z":
        addBoth("S", "TS");
        pos += (at(pos + 1) === "Z") ? 2 : 1;
        break;
      default:
        pos++;
        break;
    }
  }

  return {
    primary: primary.slice(0, MAX_LEN),
    alternate: alternate.slice(0, MAX_LEN),
  };
}
