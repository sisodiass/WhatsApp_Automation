// Tiny class-merging helper. Same shape as `clsx` from npm — handles
// strings, undefined/null/false, and arrays. Falls through to the
// installed clsx package if you import it elsewhere.

import clsx from "clsx";

export function cn(...args) {
  return clsx(...args);
}
