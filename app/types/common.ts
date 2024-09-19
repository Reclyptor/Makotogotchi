import { DetailedHTMLProps, HTMLAttributes } from "react";

export type StandardProps<E,T> = Omit<DetailedHTMLProps<HTMLAttributes<E>, E>, keyof T>;

export type WithStandardProps<E,T> = T & StandardProps<E,T>;