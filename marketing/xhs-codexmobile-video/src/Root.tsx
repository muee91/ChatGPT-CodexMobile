import {Composition} from 'remotion';
import {CodexMobileShowcase, codexMobileShowcaseDuration} from './CodexMobileShowcase';

export const RemotionRoot = () => {
  return (
    <Composition
      id="CodexMobileXhs"
      component={CodexMobileShowcase}
      durationInFrames={codexMobileShowcaseDuration}
      fps={30}
      width={1080}
      height={1920}
    />
  );
};
