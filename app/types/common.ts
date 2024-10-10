import { ButtonHTMLAttributes, DetailedHTMLProps, HTMLAttributes } from "react";

export type WithStandardProps<E,T> = T & Omit<DetailedHTMLProps<HTMLAttributes<E>, E>, keyof T>;

export type WithStandardButtonProps<T> = T & Omit<DetailedHTMLProps<ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>, keyof T>;