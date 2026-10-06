import type {AssistantCommand,AssistantState} from '../../../agent-contract/index.js'
const element=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T
export function createAgentSettingsView(invoke:(command:AssistantCommand)=>Promise<boolean>,onLocalStateChange:()=>void=()=>{}):{render(state:AssistantState):void;open():void;selectDriver(driverId:string):Promise<boolean>;canSend():boolean}{
  const dialog=element<HTMLDialogElement>('agent-settings'),model=element<HTMLSelectElement>('agent-model'),method=element<HTMLSelectElement>('agent-login-method'),fields=element('agent-login-fields')
  const driver=element<HTMLSelectElement>('agent-settings-driver')
  let state:AssistantState|null=null,fieldIdentity='',switching=false,refreshPending=false,autoSetup:string|null=null,selection:{driverId:string;modelId:string}|null=null
  const run=async(request:Extract<AssistantCommand,{action:'settings.run'}>['request']):Promise<boolean>=>{
    if(!state)return false
    const refresh=request.action==='refresh'||request.action==='ensure'
    if(refresh&&(refreshPending||state.settings?.driverId===state.driverId&&state.settings.phase==='working'))return true
    if(refresh)refreshPending=true
    try{return await invoke({action:'settings.run',driverId:state.driverId,request})}
    finally{if(refresh)refreshPending=false}
  }
  const clearFields=()=>{for(const input of fields.querySelectorAll<HTMLInputElement>('input'))input.value=''}
  async function selectDriver(driverId:string):Promise<boolean>{
    if(switching)return false
    switching=true;clearFields();selection=null
    try{
      if(state?.settings?.phase==='working'&&!await invoke({action:'settings.cancel'}))return false
      if(!await invoke({action:'driver.select',driverId}))return false
      autoSetup=driverId
      return await run({action:'ensure'})
    }finally{switching=false;onLocalStateChange()}
  }
  const renderFields=()=>{
    const settings=state?.settings?.driverId===state?.driverId?state?.settings?.value:null
    const login=settings?.loginMethods.find(row=>row.id===method.value),identity=(state?.driverId??'')+':'+(login?.id??'')
    if(identity===fieldIdentity)return
    fieldIdentity=identity;fields.replaceChildren()
    for(const field of login?.fields??[]){const label=document.createElement('label'),input=document.createElement('input');label.textContent=field.label;input.name=field.id;input.type=field.secret?'password':'text';input.autocomplete='off';input.required=field.required;input.maxLength=8192;input.value=field.value??'';label.append(input);fields.append(label)}
  }
  method.onchange=()=>{fieldIdentity='';renderFields()}
  driver.onchange=()=>{void selectDriver(driver.value)}
  model.onchange=()=>onLocalStateChange()
  element('agent-refresh').onclick=()=>{void run({action:'refresh'})}
  element('agent-model-refresh').onclick=()=>{void run({action:'refresh'})}
  element('agent-model-save').onclick=()=>{if(model.value&&state){selection={driverId:state.driverId,modelId:model.value};void run({action:'model.select',modelId:model.value}).then(accepted=>{if(!accepted)selection=null})}}
  element<HTMLFormElement>('agent-login').onsubmit=event=>{
    event.preventDefault();const values:Record<string,string>=Object.create(null)
    for(const input of fields.querySelectorAll<HTMLInputElement>('input')){values[input.name]=input.value;input.value=''}
    void run({action:'auth.login',methodId:method.value,values})
  }
  element('agent-logout').onclick=()=>{void run({action:'auth.logout'})}
  element('agent-settings-cancel').onclick=()=>{void invoke({action:'settings.cancel'})}
  element('agent-settings-close').onclick=()=>{clearFields();dialog.close()}
  dialog.oncancel=()=>clearFields()
  dialog.onclose=()=>{clearFields();if(state?.settings?.phase==='working')void invoke({action:'settings.cancel'})}
  return {
    open(){if(!dialog.open)dialog.showModal();if(!switching&&!state?.settings&&!state?.busy)void run({action:'ensure'});onLocalStateChange()},
    selectDriver,
    canSend(){const current=state?.settings?.driverId===state?.driverId?state?.settings:null;return !switching&&(!current||current.phase==='idle'&&current.value?.authentication.state==='ready'&&current.value.models.some(row=>row.availability==='verified'&&row.id===current.value?.selectedModel))},
    render(next){
      if(state?.driverId!==next.driverId){clearFields();fieldIdentity='';model.value='';selection=null}
      state=next
      const current=next.settings?.driverId===next.driverId?next.settings:null,value=current?.value??null,working=current?.phase==='working'
      const authenticated=value?.authentication.state==='ready',models=value?.models.filter(row=>row.availability==='verified')??[]
      element('agent-settings-title').textContent=(next.drivers.find(row=>row.id===next.driverId)?.label??'Agent')+(authenticated?' · 选择模型':' · 登录')
      element('agent-auth-state').textContent=value?.authentication.label??(working?'正在读取登录状态…':'登录状态尚未检查；可点击刷新')
      element('agent-settings-status').textContent=current?.message??''
      const checked=(at:number|null|undefined,stale:boolean|undefined,ttl:number):string=>at==null?'尚未检查 / 待检查':new Date(at).toLocaleString()+(stale||Date.now()-at>=ttl?' · 待检查':'')
      element('agent-auth-checked').textContent='登录状态检查：'+checked(current?.cache?.authenticationCheckedAt,current?.cache?.authenticationStale,5*60*1000)
      element('agent-model-checked').textContent='模型目录检查：'+checked(current?.cache?.modelsCheckedAt,current?.cache?.modelsStale,30*60*1000)
      driver.replaceChildren(...next.drivers.map(row=>{const option=document.createElement('option');option.value=row.id;option.textContent=row.label;return option}));driver.value=next.driverId
      driver.disabled=switching||next.busy&&!working
      element('agent-model-section').hidden=!authenticated
      element('agent-model-empty').hidden=!authenticated||models.length>0
      const previous=model.value;model.replaceChildren()
      const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='请选择模型';model.append(placeholder)
      for(const row of models){const option=document.createElement('option');option.value=row.id;option.textContent=row.label;option.title=row.description;model.append(option)}
      model.value=previous&&models.some(row=>row.id===previous)?previous:value?.selectedModel??''
      const previousMethod=method.value;method.replaceChildren()
      for(const row of value?.loginMethods??[]){const option=document.createElement('option');option.value=row.id;option.textContent=row.label;method.append(option)}
      if(value?.loginMethods.some(row=>row.id===previousMethod))method.value=previousMethod
      renderFields()
      const blocked=working||next.busy||switching
      for(const id of ['agent-refresh','agent-model-refresh','agent-model-save','agent-login-submit','agent-logout'])element<HTMLButtonElement>(id).disabled=blocked||(id==='agent-model-save'&&(!authenticated||!model.value))||(id==='agent-login-submit'&&!value?.loginMethods.length)||(id==='agent-logout'&&!value?.canLogout)
      model.disabled=method.disabled=blocked
      for(const input of fields.querySelectorAll<HTMLInputElement>('input'))input.disabled=blocked
      element('agent-settings-cancel').hidden=!working
      if(current&&!working&&autoSetup===next.driverId){autoSetup=null;if(!authenticated||!models.some(row=>row.id===value?.selectedModel)){if(!dialog.open)dialog.showModal()}}
      if(current?.phase==='idle'&&selection?.driverId===next.driverId&&selection.modelId===value?.selectedModel){selection=null;clearFields();dialog.close()}
    }
  }
}
