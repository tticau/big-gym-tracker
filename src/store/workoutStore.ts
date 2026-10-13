import { create } from 'zustand';

interface WorkoutState {
  isActive: boolean;
  activeWorkoutId: string | null;
  startWorkout: (routineName: string) => void;
  finishWorkout: () => void;
}

export const useWorkoutStore = create<WorkoutState>((set) => ({
  isActive: false,
  activeWorkoutId: null,
  startWorkout: (routineName: string) => {
    const newId = Date.now().toString();
    set({ isActive: true, activeWorkoutId: newId });
  },
  finishWorkout: () => {
    set({ isActive: false, activeWorkoutId: null });
  },
}));