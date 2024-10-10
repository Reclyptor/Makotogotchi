import { WithStandardProps } from "~/types/common";
import { twMerge } from "tailwind-merge";
import clsx from "clsx";

export type CardProps = WithStandardProps<HTMLDivElement, {}>;

const Card = (props: CardProps) => {
  return (
    <div { ...props } className={ twMerge(clsx("rounded-3xl backdrop-blur-3xl bg-black/20 shadow-2xl", props.className)) } />
  );
};

export default Card;