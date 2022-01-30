<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';

  import meetups from '../store/meetups-store.js';

  import MeetupItem from '../components/Meetup/MeetupItem.svelte';
  import MeetupFilter from '../components/Meetup/MeetupFilter.svelte';
  import Button from '../components/UI/Button.svelte';
  import EditMeetup from '../components/Meetup/EditMeetup.svelte';
  import LoadingSpinner from '../components/UI/LoadingSpinner.svelte';

  let fetchedMeetups = [];

  const dispatch = createEventDispatcher();

  let favsOnly = false;
  let editMode;
  let editedId = null;
  let isLoading = false;
  let isError = false;
  let unsubscribe;

  onMount(() => {
    unsubscribe = meetups.subscribe(items => fetchedMeetups = items);
    isLoading = true;
    fetch('https://vue-http-exmp-default-rtdb.firebaseio.com/meetups.json').then(res => {
      if(!res.ok) {
        throw new Error('Error fetching meetup data');
      }
      return res.json();
    }).then(data => {
      const loadedMeetups = [];
      for (const key in data) {
        loadedMeetups.push({
          ...data[key],
          id: key
        });
      }
      isError = null;
      isLoading = false;
      meetups.setMeetups(loadedMeetups.reverse());
    }).catch(err => {
      isError = err;
      isLoading = false;
      // console.log(err.message);
    });
  });

  onDestroy(() => {
    if(unsubscribe) {
      unsubscribe();
    }
  });

  $: filteredMeetups = favsOnly ? fetchedMeetups.filter(m => m.isFavorite) : fetchedMeetups;

  function selectComponent(event) {
    favsOnly = event.detail === 'fav-meetup';
  }

  function onSaveMeetup() {
    editMode = null;
    editedId = null;
  }

  function cancelEdit() {
    editMode = null;
    editedId = null;
  }

  function onEditMeetup(event) {
    editMode = 'edit';
    editedId = event.detail;
  }

  function onErrorEditPage(event) {
    isError = {};
    isError.message = event.detail;
  }
</script>

<style>
  #meetups {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr;
    grid-gap: 1rem;
  }

  #meetup-controls {
    margin: 1rem;
    display: flex;
    justify-content: space-between;
  }

  #no-meetups {
    margin: 1rem;
  }

  @media (min-width: 768px) {
    #meetups {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>

<svelte:head>
	<title>Infinity Meetups</title>
</svelte:head>

{#if editMode === 'edit'}
  <EditMeetup id={editedId} on:save-form-data={onSaveMeetup} on:cancel="{cancelEdit}"
  on:error-modal="{onErrorEditPage}" />
{/if}

{#if isLoading}
  <LoadingSpinner/>
{:else}
  <section id="meetup-controls">
    <MeetupFilter on:select-component="{selectComponent}" />
    <Button on:click="{() => dispatch('add-meetup')}">New Meetup</Button>
  </section>
{#if filteredMeetups.length === 0}
  <p id="no-meetups">No meetups found!, Please add some.</p>
{/if}
  <section id="meetups">
    {#each filteredMeetups as meetup (meetup.id)}
      <div transition:scale animate:flip="{{duration: 700}}">
        <MeetupItem title={meetup.title} subtitle={meetup.subtitle} description={meetup.description}
        imageUrl={meetup.imageUrl} address={meetup.address} email={meetup.contactEmail} 
        id={meetup.id} isFav={meetup.isFavorite} on:show-details on:edit-meetup/>
      </div>
    {/each}
  </section>
{/if}

