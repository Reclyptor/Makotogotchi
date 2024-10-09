import Makoto from "~/components/Makoto";
import useMakotoState from "~/hooks/useMakotoState";
import { range } from "~/util/array";
import { useRef, useState } from "react";
import { Atom as EnergyIcon, Heart as HeartIcon } from "lucide-react";
import sideIdle1 from "~/resources/SideIdle1.png";
import sideIdle2 from "~/resources/SideIdle2.png";

export default function Index() {
  const { state, dispatch, reset } = useMakotoState();
  const { current: debug } = useRef<boolean>([...new URL(location.href).searchParams.keys()].includes("debug"));
  const [menuOpen, setMenuOpen] = useState<boolean>(false);

  return (
    <div className="w-screen h-screen overflow-hidden">
      <div className="flex items-center justify-center w-full h-full [background-image:linear-gradient(32deg,_rgba(217,_202,_178,_0.40)_16.67%,_rgba(179,_161,_132,_0.40)_16.67%,_rgba(179,_161,_132,_0.40)_33.33%,_rgba(147,_126,_92,_0.40)_33.33%,_rgba(147,_126,_92,_0.40)_50%,_rgba(217,_202,_178,_0.40)_50%,_rgba(217,_202,_178,_0.40)_66.67%,_rgba(179,_161,_132,_0.40)_66.67%,_rgba(179,_161,_132,_0.40)_83.33%,_rgba(147,_126,_92,_0.40)_83.33%,_rgba(147,_126,_92,_0.40)_100%);] [background-size:113.22px_70.75px;] [animation:slide_10s_infinite] backdrop-blur-3xl">
        { debug &&
          <div className="absolute top-1 left-1 p-2 rounded-lg backdrop-blur-3xl bg-black/20 shadow-2xl overflow-hidden">
            <pre className="font-bold text-sm text-[--background]">{ JSON.stringify(state, null, 2) }</pre>
          </div>
        }

        <button type="button" onClick={ reset } className="group absolute top-1 right-1 flex items-center justify-center w-8 h-8 rounded-full backdrop-blur-3xl bg-black/20 hover:bg-black/50 shadow-2xl overflow-hidden">
          <span className="text-[8px] font-bold text-black group-hover:text-[--background]">RESET</span>
        </button>

        <div
          className="flex flex-col items-center justify-center w-fit h-fit overflow-hidden rounded-3xl backdrop-blur-3xl bg-black/20 shadow-2xl">
          <div className="flex items-center w-fit h-fit p-4">
            { range(10).map((idx) => <HeartIcon key={ idx } size={ 32 } stroke="#6F1200" fill={ Math.trunc(state.hp / 10) > idx ? "#6F1200" : "transparent" }/>) }
          </div>

          <Makoto state={ state }/>

          <div className="flex items-center w-fit h-fit p-4">
            { range(10).map((idx) => <EnergyIcon key={ idx } size={ 32 } strokeWidth={ 1.25 } stroke={ Math.trunc(state.energy / 10) > idx ? "#F2EFE5" : "#00000040" } fill={ Math.trunc(state.energy / 10) > idx ? "#F2EFE526" : "#FFFFFF2E" } />) }
          </div>
        </div>

        <button type="button" onClick={ () => setMenuOpen(!menuOpen) } className="absolute bottom-2 right-2 flex items-center justify-center w-16 h-16 rounded-full backdrop-blur-3xl bg-black/20 hover:bg-black/50 shadow-2xl overflow-hidden">
          { menuOpen ? <img src={ sideIdle2 } alt="Close" className="w-8 h-8"/> : <img src={ sideIdle1 } alt="Open" className="w-8 h-8"/> }
        </button>
      </div>
    </div>
  );
}
