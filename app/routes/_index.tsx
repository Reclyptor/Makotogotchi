import Makoto from "~/components/Makoto";
import useMakotoState, { MakotoAction } from "~/hooks/useMakotoState";
import { range } from "~/util/array";
import { useRef, useState } from "react";
import {
  Atom as EnergyIcon,
  Bath as BathIcon,
  Fish as FeedIcon,
  Gamepad2 as PlayIcon,
  Hand as PetIcon,
  Heart as HeartIcon,
  Lamp as SleepIcon,
  Syringe as MedicateIcon,
} from "lucide-react";
import { FaVirusCovid as SickIcon } from "react-icons/fa6";
import sideIdle1 from "~/resources/SideIdle1.png";
import sideIdle2 from "~/resources/SideIdle2.png";
import Card from "~/components/Card";
import Button from "~/components/Button";
import clsx from "clsx";

export default function Index() {
  const { state, dispatch, reset } = useMakotoState();
  const { current: debug } = useRef<boolean>([...new URL(location.href).searchParams.keys()].includes("debug"));
  const [menuOpen, setMenuOpen] = useState<boolean>(false);

  return (
    <div className="w-dvw h-dvh overflow-hidden">
      <div className="flex items-center justify-center w-full h-full [background-image:linear-gradient(32deg,_rgba(217,_202,_178,_0.40)_16.67%,_rgba(179,_161,_132,_0.40)_16.67%,_rgba(179,_161,_132,_0.40)_33.33%,_rgba(147,_126,_92,_0.40)_33.33%,_rgba(147,_126,_92,_0.40)_50%,_rgba(217,_202,_178,_0.40)_50%,_rgba(217,_202,_178,_0.40)_66.67%,_rgba(179,_161,_132,_0.40)_66.67%,_rgba(179,_161,_132,_0.40)_83.33%,_rgba(147,_126,_92,_0.40)_83.33%,_rgba(147,_126,_92,_0.40)_100%);] [background-size:113.22px_70.75px;] [animation:slide_10s_infinite] backdrop-blur-3xl">
        { debug &&
          <Card className="absolute top-1 left-1 p-2 z-[1] rounded-lg overflow-hidden">
            <pre className="font-bold text-sm text-[--background]">{ JSON.stringify(state, null, 2) }</pre>
          </Card>
        }

        <Button type="button" onClick={ reset } className="group absolute top-1 right-1 flex items-center justify-center w-8 h-8 z-[1] rounded-full overflow-hidden">
          <span className="text-[8px] font-bold text-black group-hover:text-[--background]">RESET</span>
        </Button>

        <Card className="flex flex-col items-center justify-center w-fit h-fit overflow-hidden">
          <div className="flex items-center w-fit h-fit p-4">
            { range(10).map((idx) => <HeartIcon key={ idx } size={ 32 } stroke="#6F1200" fill={ Math.trunc(state.happiness / 10) > idx ? "#6F1200" : "transparent" } />) }
          </div>

          { state.sick && <SickIcon size={ 28 } color="#000" fill="#64478D" className="absolute top-14 right-5" /> }

          <Makoto state={ state }/>

          <div className="flex items-center w-fit h-fit p-4">
            { range(10).map((idx) => <EnergyIcon key={ idx } size={ 32 } strokeWidth={ 1.25 } stroke={ Math.trunc(state.energy / 10) > idx ? "#F2EFE5" : "#00000040" } fill={ Math.trunc(state.energy / 10) > idx ? "#F2EFE526" : "#FFFFFF2E" } />) }
          </div>
        </Card>

        <Button type="button" onClick={ () => setMenuOpen(!menuOpen) } className="absolute bottom-2 right-2 flex items-center justify-center w-16 h-16  z-[1] rounded-full overflow-hidden">
          { menuOpen ? <img src={ sideIdle2 } alt="Close" className="w-8 h-8"/> : <img src={ sideIdle1 } alt="Open" className="w-8 h-8" /> }
        </Button>

        <>
          <Button onClick={ () => { dispatch(MakotoAction.FEED); setMenuOpen(false); } } className={ clsx("absolute flex items-center justify-center w-12 h-12 transition-[bottom,right,opacity] duration-700 ease-in-out", { "bottom-4 right-4 opacity-0 -z-[1] pointer-events-none": !menuOpen, "bottom-[calc(8px+calc(cos(00deg)*180px))] right-[calc(8px+calc(sin(00deg)*180px))] opacity-100 z-[1]": menuOpen }) }><FeedIcon className="stroke-[--background]" /></Button>
          <Button onClick={ () => { dispatch(MakotoAction.SLEEP); setMenuOpen(false); } } className={ clsx("absolute flex items-center justify-center w-12 h-12 transition-[bottom,right,opacity] duration-700 ease-in-out", { "bottom-4 right-4 opacity-0 -z-[1] pointer-events-none": !menuOpen, "bottom-[calc(8px+calc(cos(18deg)*180px))] right-[calc(8px+calc(sin(18deg)*180px))] opacity-100 z-[1]": menuOpen }) }><SleepIcon className="stroke-[--background]" /></Button>
          <Button onClick={ () => { dispatch(MakotoAction.PLAY); setMenuOpen(false); } } className={ clsx("absolute flex items-center justify-center w-12 h-12 transition-[bottom,right,opacity] duration-700 ease-in-out", { "bottom-4 right-4 opacity-0 -z-[1] pointer-events-none": !menuOpen, "bottom-[calc(8px+calc(cos(36deg)*180px))] right-[calc(8px+calc(sin(36deg)*180px))] opacity-100 z-[1]": menuOpen }) }><PlayIcon className="stroke-[--background]" /></Button>
          <Button onClick={ () => { dispatch(MakotoAction.MEDICATE); setMenuOpen(false); } } className={ clsx("absolute flex items-center justify-center w-12 h-12 transition-[bottom,right,opacity] duration-700 ease-in-out", { "bottom-4 right-4 opacity-0 -z-[1] pointer-events-none": !menuOpen, "bottom-[calc(8px+calc(cos(54deg)*180px))] right-[calc(8px+calc(sin(54deg)*180px))] opacity-100 z-[1]": menuOpen }) }><MedicateIcon className="stroke-[--background]" /></Button>
          <Button onClick={ () => { dispatch(MakotoAction.BATHE); setMenuOpen(false); } } className={ clsx("absolute flex items-center justify-center w-12 h-12 transition-[bottom,right,opacity] duration-700 ease-in-out", { "bottom-4 right-4 opacity-0 -z-[1] pointer-events-none": !menuOpen, "bottom-[calc(8px+calc(cos(72deg)*180px))] right-[calc(8px+calc(sin(72deg)*180px))] opacity-100 z-[1]": menuOpen }) }><BathIcon className="stroke-[--background]" /></Button>
          <Button onClick={ () => { dispatch(MakotoAction.PET); setMenuOpen(false); } } className={ clsx("absolute flex items-center justify-center w-12 h-12 transition-[bottom,right,opacity] duration-700 ease-in-out", { "bottom-4 right-4 opacity-0 -z-[1] pointer-events-none": !menuOpen, "bottom-[calc(8px+calc(cos(90deg)*180px))] right-[calc(8px+calc(sin(90deg)*180px))] opacity-100 z-[1]": menuOpen }) }><PetIcon className="stroke-[--background]" /></Button>
        </>
      </div>
    </div>
  );
}
