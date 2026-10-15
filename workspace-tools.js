/** Small template and transfer sheets, using the shared focus/history behavior. */
(function () {
  const Core = window.DailySpaceWorkspaceCore;
  const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
  function errorText(error) {
    const message=error.message||String(error), translations={
      'Invalid date.':'日期无效。','Invalid time.':'时间无效。','Invalid expense.':'费用记录无效。','Invalid currency.':'币种无效，请填写有效的三字母币种代码。','Invalid completion state.':'任务完成状态必须为 true 或 false。',
      'Invalid JSON file.':'JSON 文件格式无效。','Invalid JSON data section.':'JSON 数据段格式无效。',
      'Use a Daily Space JSON backup.':'请选择 Daily Space JSON 备份。','No supported workspace data found.':'没有找到可导入的工作区数据。',
      'Task text is required.':'任务标题不能为空。','Template name is required.':'模板名称不能为空。','A template needs at least one task.':'模板至少需要一条任务。',
      'Invalid template day offset.':'模板的相对日期需在 0 至 365 天之间。','Too many or invalid records.':'记录过多或数据格式不正确。',
      'Duplicate record IDs in this file.':'文件内存在重复的记录 ID。','Invalid record ID.':'记录 ID 无效。',
      'Device data changed. Preview the file again.':'本机数据已发生更改，请重新预览文件。',
      'The backup and current ledger use different base currencies.':'备份与当前账本的本位币不同，请先统一本位币。',
      'Foreign currency expenses require a valid exchange rate.':'外币费用需要提供有效汇率。',
      'Shared expense participants are missing. Use a JSON backup.':'共享费用缺少分摊成员信息，请使用 JSON 备份。',
      'File is too large (maximum 1 MB).':'文件过大，最大支持 1 MB。','Merged workspace exceeds the 1 MB sync limit.':'合并后的工作区超过 1 MB 同步容量。',
      'Invalid CSV quoting.':'CSV 引号格式不正确。','Unclosed CSV quote.':'CSV 引号未闭合。','Duplicate CSV column.':'CSV 存在重复列。',
      'CSV needs a header and 1–1000 rows.':'CSV 需包含表头和 1 至 1000 行数据。',
    };
    const row=message.match(/^CSV row (\d+) has the wrong number of columns\.$/);if(row)return t(message,`CSV 第 ${row[1]} 行的列数不正确。`);
    return t(message,translations[message]||message);
  }
  const readTemplates = () => { try { return JSON.parse(localStorage.getItem(Core.TEMPLATE_KEY) || '{}').templates || []; } catch (_) { return []; } };
  const emit = domains => window.dispatchEvent(new CustomEvent('daily-space-agent-data-updated', { detail: { domains } }));
  function node(tag, content = '', cls = '') { const value = document.createElement(tag); value.textContent = content; if (cls) value.className = cls; return value; }
  function action(content, run) { const value = node('button', content); value.type = 'button'; value.addEventListener('click', run); return value; }
  function download(value, filename, type='application/json') { const url=URL.createObjectURL(new Blob([value],{type}));const link=node('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000); }
  function boot() {
    let mode = '', fileGeneration = 0, pending = null, pendingOwner = '', selection = [], editingTemplateId = null;
    const root=node('div','','workspace-tool-sheet'); root.hidden=true;root.dataset.dialogRoot='';root.dataset.i18nIgnore='';
    const backdrop=action('',()=>close());backdrop.className='workspace-tool-backdrop';backdrop.dataset.dialogClose='';backdrop.setAttribute('aria-label',t('Close','关闭'));
    const panel=node('section','','workspace-tool-panel');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','workspace-tool-title');
    const header=node('header');const title=node('h2');title.id='workspace-tool-title';const dismiss=action('×',()=>close());dismiss.dataset.dialogClose='';dismiss.setAttribute('aria-label',t('Close','关闭'));header.append(title,dismiss);
    const body=node('div','','workspace-tool-body');const footer=node('footer','','workspace-tool-footer');const status=node('p','','workspace-tool-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    panel.append(header,body,status,footer);root.append(backdrop,panel);document.body.append(root);window.DailySpaceDialogHistory.fitViewport(root);
    const motion=window.DailySpaceDialogHistory.motion(root);
    const history=window.DailySpaceDialogHistory.create('workspace-tools',{isOpen:()=>!root.hidden&&!motion.closing,restore:data=>open(data.mode,false),close:()=>close(true)});
    function close(fromHistory=false,immediate=false){if(motion.closing&&!immediate)return;fileGeneration++;pending=null;motion.close(()=>document.body.classList.remove('workspace-tool-open'),immediate);if(!fromHistory)history.back();}
    function show(next,push=true){if(push&&!history.push({mode:next}))return false;fileGeneration++;pending=null;mode=next;pendingOwner=window.DailySpaceView.owner();status.textContent='';body.replaceChildren();footer.replaceChildren();motion.open();document.body.classList.add('workspace-tool-open');return true;}
    function open(next,push=true){if(!show(next,push))return;if(next==='templates')templates();else transfer();body.scrollTop=0;}
    function builtins(){return [
      {id:'builtin-focus',name:t('A focused day','专注的一天'),items:[{text:t('Choose today’s most important task','确定今天最重要的一件事')},{text:t('Make time for focused work','安排一段专注时间')},{text:t('Reflect on today','做一次简短复盘')}]},
      {id:'builtin-review',name:t('Weekly review','每周复盘'),items:[{text:t('Review the week','回顾这一周'),subtasks:[{text:t('Review unfinished tasks','检查未完成的任务')},{text:t('Note what worked','记录有效的做法')},{text:t('Choose next week’s priorities','确定下周的重点')}]}]},
      {id:'builtin-packing',name:t('Travel checklist','旅行出发清单'),items:[{text:t('Prepare for the trip','做好旅行准备'),subtasks:[{text:t('Check documents and bookings','核对证件和预订')},{text:t('Pack essentials','准备必需物品')},{text:t('Confirm transport and budget','确认交通与预算')}]}]},
    ];}
    function writeTemplates(items){localStorage.setItem(Core.TEMPLATE_KEY,JSON.stringify({version:1,templates:items}));emit(['templates']);}
    function templates(){
      title.textContent=t('Task templates','任务模板');const list=node('div','','workspace-template-list');let chosen=null;const apply=action(t('Add these tasks','添加这些任务'),()=>{
        try{if(motion.closing||!chosen||!Core.date(day.value)||pendingOwner!==window.DailySpaceView.owner())return;window.DailySpaceTaskDetails?.clearSelection?.();const tasks=window.DailySpaceTodo.createTasks(Core.instantiate(chosen,day.value));window.DailySpaceTodo.selectDueDay(day.value);window.DailySpaceTodo.setFilter('active');close();}catch(error){status.textContent=errorText(error);}
      });apply.className='btn btn-primary';apply.disabled=true;
      const dateLabel=node('label',t('Start date','开始日期'));const day=node('input');day.type='date';day.value=window.DailySpaceTodo?.getView().day||window.DailySpaceLoop.todayIso();day.required=true;dateLabel.append(day);
      const preview=node('ul','','workspace-template-preview');
      [...builtins(),...readTemplates()].forEach(template=>{const row=node('div','','workspace-template-row');const pick=action(template.name,()=>{chosen=template;list.querySelectorAll('button[data-template-id]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.templateId===template.id)));preview.replaceChildren(...template.items.map(item=>node('li',`${item.text}${item.offsetDays?` · +${item.offsetDays} ${t('days','天')}`:''}`)));apply.disabled=false;});pick.dataset.templateId=template.id;pick.setAttribute('aria-pressed','false');row.append(pick);
        if(!template.id.startsWith('builtin-')){const edit=action(t('Edit','编辑'),()=>editTemplate(template));const remove=action('×',()=>{const previous=readTemplates();writeTemplates(previous.filter(item=>item.id!==template.id));close();window.DailySpaceUndo?.offer(t('Template deleted','已删除模板'),()=>{const current=readTemplates();if(!current.some(item=>item.id===template.id)){writeTemplates([...current,template]);if(!root.hidden&&mode==='templates')templates();}});});remove.setAttribute('aria-label',t('Delete template','删除模板'));row.append(edit,remove);}list.append(row);});
      const create=action(t('New template','新建模板'),()=>editTemplate(null));create.className='workspace-template-create';
      body.replaceChildren(node('p',t('Reuse a checklist or start with a simple routine.','复用常用清单，或从一个简单的日常安排开始。')),list,create,dateLabel,preview);
      footer.replaceChildren(apply);
    }
    function editTemplate(existing,selectedTasks){
      editingTemplateId=existing?.id||null;title.textContent=t('Save a task template','保存任务模板');body.replaceChildren();footer.replaceChildren();status.textContent='';
      const nameLabel=node('label',t('Template name','模板名称'));const name=node('input');name.maxLength=60;name.required=true;name.value=existing?.name||'';name.dataset.templateName='';nameLabel.append(name);
      const contentLabel=node('label',t('Tasks · one per line','任务 · 每行一条'));const content=node('textarea');content.rows=6;content.maxLength=50000;content.dataset.templateTasks='';let source=existing|| (selectedTasks?.length?Core.fromTasks(selectedTasks,window.DailySpaceTodo.getCategories(),'Draft'):null);
      const draftKey=`daily-space-template-draft:${pendingOwner}:${existing?.id||'new'}`;let draft;try{draft=JSON.parse(localStorage.getItem(draftKey)||'null');}catch(_){}content.value=source?.items.map(item=>item.text).join('\n')||'';contentLabel.append(content);
      if(draft){name.value=draft.name||'';content.value=draft.content||content.value;if(!source&&draft.items)source=Core.template({id:Core.uid(),name:'Draft',items:draft.items});}
      const stash=()=>{localStorage.setItem(draftKey,JSON.stringify({name:name.value,content:content.value,items:source?.items||null}));};name.addEventListener('input',stash);content.addEventListener('input',stash);
      body.append(nameLabel,contentLabel,node('p',t('Notes, subtasks and relative dates are kept for unchanged task titles.','未更改标题的任务会保留备注、子任务和相对日期。')));
      const save=action(t('Save template','保存模板'),()=>{try{if(!name.value.trim()||!content.value.trim()){status.textContent=t('Enter a name and at least one task.','请输入名称和至少一条任务。');return;}if(pendingOwner!==window.DailySpaceView.owner())return;
        const used=new Set();const items=content.value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean).map(title=>{const index=source?.items.findIndex((item,index)=>!used.has(index)&&item.text===title)??-1;if(index>=0){used.add(index);return source.items[index];}return{text:title};});
        const result=Core.template({id:editingTemplateId||Core.uid(),name:name.value,items});const current=readTemplates();if(editingTemplateId&&JSON.stringify(current.find(item=>item.id===editingTemplateId))!==JSON.stringify(existing))throw new Error(t('This template changed. Reopen it before saving.','此模板已更改，请重新打开后再保存。'));if(!editingTemplateId&&current.length>=50)throw new Error(t('Up to 50 templates are supported.','最多保存 50 个模板。'));writeTemplates(editingTemplateId?current.map(item=>item.id===editingTemplateId?result:item):[...current,result]);localStorage.removeItem(draftKey);templates();
      }catch(error){status.textContent=errorText(error);}});save.className='btn btn-primary';footer.append(action(t('Back to templates','返回模板'),templates),save);name.focus({preventScroll:true});
    }
    function transfer(){
      title.textContent=t('Import & backup','导入与备份');const label=node('label',t('File format','文件格式'));const format=node('select');format.id='workspace-import-format';for(const [key,en,zh]of[['json','Daily Space JSON backup','Daily Space JSON 备份'],['todo','Task CSV','待办 CSV'],['tally','Expense CSV','记账 CSV']])format.add(new Option(t(en,zh),key));label.append(format);
      const fileLabel=node('label',t('Choose a file','选择文件'));const file=node('input');file.type='file';file.accept='.json,.csv,application/json,text/csv';file.id='workspace-import-file';fileLabel.append(file);
      const preview=node('div','','workspace-import-preview');preview.id='workspace-import-preview';const commit=action(t('Merge import','合并导入'),()=>{
        try{if(motion.closing||!pending||pendingOwner!==window.DailySpaceView.owner())return;Core.apply(pending,localStorage);const domains=Object.keys(pending.payload).map(key=>({'todo-app-v2':'todo','calendar-app-v1':'calendar','planner-app-v1':'planner','tally-book-v1':'tally','travel-book-v1':'travel','task-templates-v1':'templates'}[key]));
          const linked=window.DailySpaceTasks?.syncLinkedWork({silent:true});emit(linked?.changed?[...new Set([...domains,'todo','calendar','planner'])]:domains);status.textContent=t('Imported. Existing records were kept.','导入完成，已保留现有记录。');pending=null;commit.disabled=true;
        }catch(error){status.textContent=errorText(error);pending=null;commit.disabled=true;}
      });commit.id='workspace-import-apply';commit.className='btn btn-primary';commit.disabled=true;
      async function inspect(){const ticket=++fileGeneration;pending=null;commit.disabled=true;preview.replaceChildren();status.textContent='';const selected=file.files[0];if(!selected)return; if(selected.size>1024*1024){status.textContent=t('File is too large (maximum 1 MB).','文件过大，最大支持 1 MB。');return;}
        try{const source=await selected.text();if(ticket!==fileGeneration||root.hidden||pendingOwner!==window.DailySpaceView.owner())return;pending=Core.prepare(source,format.value,localStorage);
          const names={'todo-app-v2':t('Tasks','待办'),'calendar-app-v1':t('Reminders','提醒'),'planner-app-v1':t('Project items','项目条目'),'tally-book-v1':t('Expenses','费用'),'travel-book-v1':t('Trip items','行程条目'),'task-templates-v1':t('Templates','模板')};
          preview.append(node('p',selected.name));for(const row of pending.summary)preview.append(node('p',`${names[row.key]} · +${row.added} ${t('new','新增')} · ${row.skipped} ${t('existing kept','条现有记录保留')}${row.categoriesAdded?` · +${row.categoriesAdded} ${t('categories','分类')}`:''}`));if(pending.ignored)preview.append(node('p',t('Account settings and unsupported sections are excluded.','账号设置及不支持的数据段未导入。')));commit.disabled=!Object.keys(pending.payload).some(key=>pending.payload[key]!==pending.baseline[key]);
        }catch(error){status.textContent=t('Cannot import this file:','无法导入此文件：')+' '+errorText(error);}
      }
      file.addEventListener('change',inspect);format.addEventListener('change',()=>{file.accept=format.value==='json'?'.json,application/json':'.csv,text/csv';inspect();});
      const help=node('details');help.append(node('summary',t('Supported formats','支持的格式')),node('p',t('JSON restores tasks, calendar, projects, expenses, personal trips and templates. Existing IDs keep this device’s version. Account access and shared-trip permissions are excluded.','JSON 可导入待办、日历、项目、记账、个人旅行和模板。同 ID 保留本机版本；不会导入账号访问权限或共享行程权限。')),node('p',t('Task CSV: text,dueDate,dueTime,category,notes. Expense CSV: date,amount,currency,fxRate,category,note. Dates use YYYY-MM-DD; foreign currency needs a rate to the current base currency.','待办 CSV：text,dueDate,dueTime,category,notes。记账 CSV：date,amount,currency,fxRate,category,note。日期使用 YYYY-MM-DD；外币需提供兑账本本位币汇率。')));
      const sample=action(t('Download CSV example','下载 CSV 示例'),()=>download(format.value==='tally'?'date,amount,currency,fxRate,category,note\n2026-10-14,32,JPY,1,Coffee,Example\n':'text,dueDate,dueTime,category,notes\nReview notes,2026-10-14,14:00,Work,Example\n',format.value==='tally'?'expenses-example.csv':'tasks-example.csv','text/csv;charset=utf-8'));help.append(sample);
      body.append(label,fileLabel,preview,help);footer.append(action(t('Download device backup','下载本机备份'),()=>download(JSON.stringify(Core.backup(localStorage),null,2),'daily-space-backup.json')),commit);
    }
    const chromeLabels=[];const chromeAction=(en,zh,run)=>{const control=action(t(en,zh),run);control.dataset.i18nIgnore='';chromeLabels.push({control,en,zh});return control;};
    const api=window.DailySpaceTodo;
    if(api){const anchor=document.querySelector('.m-add-bar')||document.getElementById('add-form');if(anchor){const shortcuts=node('div','','workspace-task-shortcuts');shortcuts.append(chromeAction('Templates','模板',()=>open('templates')));if(anchor.matches('.m-add-bar'))anchor.prepend(shortcuts);else anchor.after(shortcuts);}}
    const menu=document.querySelector('#tally-tools .workspace-menu-panel');if(menu)menu.append(chromeAction('Import & backup','导入与备份',()=>{document.getElementById('tally-tools').open=false;open('transfer');}));
    const account=document.querySelector('.auth-modal .auth-provider-list');if(account){const control=chromeAction('Import & backup','导入与备份',()=>open('transfer'));control.className='auth-data-tools';account.after(control);}
    window.DailySpaceWorkspaceTools={open:()=>open('transfer'),openTemplates:()=>open('templates'),saveTemplate(ids){selection=window.DailySpaceTodo.getTasks().filter(task=>ids.includes(task.id));if(!show('templates'))return;try{editTemplate(null,selection);}catch(error){status.textContent=errorText(error);}}};
    window.addEventListener('daily-space-auth-updated',()=>{close(true,true);pendingOwner='';selection=[];});
    window.addEventListener('daily-space-locale-changed',()=>{chromeLabels.forEach(({control,en,zh})=>control.textContent=t(en,zh));if(!root.hidden)close();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
