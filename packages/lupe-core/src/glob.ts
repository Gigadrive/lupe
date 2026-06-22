/**
 * Minimal glob → RegExp used across the engine: by the diff-compression path
 * filters (`@gigadrive/lupe-git`) and the per-path filter thresholds
 * (`review/filter.ts`). Kept here so both share ONE matcher with no extra
 * dependency. `**` => any (incl. `/`), `*` => one segment, `?` => one char.
 */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') re += '[^/]';
    else if ('.+^${}()|[]\\'.includes(c)) re += `\\${c}`;
    else if (c === '/') re += '/';
    else re += c;
  }
  return new RegExp(`(^|/)${re}$|^${re}$`);
}
