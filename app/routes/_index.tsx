import Makoto from "~/components/Makoto";
import useMakotoState from "~/hooks/useMakotoState";

export default function Index() {
  const { state, dispatch } = useMakotoState();

  return (
    <div className="w-screen h-screen overflow-hidden">
      <div className="flex items-center justify-center w-full h-full [background-image:linear-gradient(32deg,_rgba(217,_202,_178,_0.40)_16.67%,_rgba(179,_161,_132,_0.40)_16.67%,_rgba(179,_161,_132,_0.40)_33.33%,_rgba(147,_126,_92,_0.40)_33.33%,_rgba(147,_126,_92,_0.40)_50%,_rgba(217,_202,_178,_0.40)_50%,_rgba(217,_202,_178,_0.40)_66.67%,_rgba(179,_161,_132,_0.40)_66.67%,_rgba(179,_161,_132,_0.40)_83.33%,_rgba(147,_126,_92,_0.40)_83.33%,_rgba(147,_126,_92,_0.40)_100%);] [background-size:113.22px_70.75px;] [animation:slide_10s_infinite] backdrop-blur-3xl">
        <Makoto state={ state } />
      </div>
    </div>
  );
}
