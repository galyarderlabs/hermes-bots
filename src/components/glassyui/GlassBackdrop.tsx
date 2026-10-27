// Android blurs only what sits in a GlassBackdrop; iOS blurs whatever is
// behind. Every GlassSurface on Android must live inside one of these.
import { createContext, useContext, type ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

const Ctx = createContext(false);
export function useGlassBackdrop(): boolean {
  return useContext(Ctx);
}

export function GlassBackdrop({ children, ...props }: ViewProps & { children: ReactNode }) {
  return (
    <Ctx.Provider value>
      <View {...props}>{children}</View>
    </Ctx.Provider>
  );
}
