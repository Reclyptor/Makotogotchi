import { WithStandardProps } from "~/types/common";
import { twMerge } from "tailwind-merge";
import clsx from "clsx";
import { ButtonHTMLAttributes, DetailedHTMLProps, HTMLAttributes } from "react";

export type ButtonProps = {};

const Button = (props: ButtonProps & DetailedHTMLProps<ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>) => {
  return (
    <button { ...props } className={ twMerge(clsx("rounded-3xl backdrop-blur-3xl bg-black/20 hover:bg-black/50 shadow-2xl", props.className)) } />
  );
};

export default Button;