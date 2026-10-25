import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { usePlayerStore } from '../../stores/player';
import { usePreferencesStore } from '../../stores/preferences';
import { setAccountScope } from '../../api/accountContext';
import { accountApi } from '../../api/commands/accounts';
import { preferencesApi } from '../../api/commands/preferences';
import { mpvCommand } from './mpv';
import { createPlayerPreferences } from './preferences';
vi.mock('../../api/commands/accounts', () => ({ accountApi: { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../api/commands/preferences', () => ({ preferencesApi: { getRecord: vi.fn(), setRecord: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('./mpv', () => ({ mpvCommand: vi.fn().mockResolvedValue(undefined) }));
describe('AV progress isolation', () => {
  beforeEach(() => { setActivePinia(createPinia()); setAccountScope('owner'); vi.clearAllMocks(); });
  function setup() {
    const player=usePlayerStore(), preferences=usePreferencesStore();
    preferences.loaded=true; preferences.values.remember_playback=true;
    Object.assign(player,{mode:'av',sourceKey:'IPX-607',episode:{id:1,video_path:'original.mp4'},currentTime:40,duration:120});
    const options={player,avCode:()=>player.sourceKey,report:vi.fn(),pollStatus:vi.fn().mockResolvedValue(undefined),setVolume:vi.fn().mockResolvedValue(undefined),setSpeed:vi.fn().mockResolvedValue(undefined),setLoop:vi.fn().mockResolvedValue(undefined),applyFit:vi.fn().mockResolvedValue(undefined)};
    return {player,preferences,options,controller:createPlayerPreferences(options)};
  }
  it('writes distinct original/cut records without touching media records', () => {
    const {player,controller}=setup(); controller.save();
    expect(accountApi.set).toHaveBeenLastCalledWith('av-playback','IPX-607:original','{"position":40}');
    player.episode={id:2,video_path:'cut.mp4'}; player.currentTime=15; controller.save();
    expect(accountApi.set).toHaveBeenLastCalledWith('av-playback','IPX-607:cut','{"position":15}');
    expect(preferencesApi.setRecord).not.toHaveBeenCalled(); controller.dispose();
  });
  it('discards a late resume after account change and resumes the matching version', async () => {
    const {player,controller}=setup(); let finish!:(value:string)=>void;
    vi.mocked(accountApi.get).mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
    const pending=controller.resume(player.episode!); setAccountScope('other'); finish('{"position":45}'); await pending;
    expect(mpvCommand).not.toHaveBeenCalled(); setAccountScope('owner');
    vi.mocked(accountApi.get).mockResolvedValueOnce('{"position":54}'); await controller.resume(player.episode!);
    expect(mpvCommand).toHaveBeenCalledWith('seek',[54,'absolute+exact']); controller.dispose();
  });
  it('does not overwrite a saved position when loading fails before duration is known', () => {
    const {player,controller}=setup(); player.duration=0; controller.save();
    expect(accountApi.set).not.toHaveBeenCalled(); expect(preferencesApi.setRecord).not.toHaveBeenCalled(); controller.dispose();
  });
  it('keeps media random preference while applying a local nonrandom AV mode', async () => {
    const {player,preferences,options,controller}=setup();
    player.libmpvReady=true; preferences.values.player_loop='random'; await nextTick();
    expect(player.loopMode).toBe('off'); expect(preferences.values.player_loop).toBe('random');
    expect(options.setLoop).toHaveBeenCalledWith('off'); controller.dispose();
  });
});
