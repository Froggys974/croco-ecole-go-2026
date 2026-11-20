/**
 * Runtime Go des types Either de DuploJS (regroupés sous l'interface Either).
 *
 * - unit.ts      : EitherFail / Ok (0B), EitherSuccess / Error[T], EitherLeft / Right[T].
 * - compact.ts   : EitherCompact[T] pour Success<T> | Fail sans boxing interface.
 * - tagged.ts    : EitherTagged[R, L] pour unions multi-Either homogènes.
 * - anyChecks.ts : EitherIsRightAny / EitherIsLeftAny pour variables any.
 */
export * from "./either/index";
