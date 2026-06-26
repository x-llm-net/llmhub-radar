import { THEME_KEYS } from "@openstatus/theme-store";
import {
  createSearchParamsCache,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
} from "nuqs/server";

export const searchParamsParsers = {
  q: parseAsString,
  t: parseAsStringEnum(THEME_KEYS).withDefault("default"),
  b: parseAsBoolean.withDefault(false),
  offset: parseAsInteger.withDefault(0),
};

export const searchParamsCache = createSearchParamsCache(searchParamsParsers);
