<script>
  import { createEventDispatcher } from 'svelte';

  import meetups from '../../store/meetups-store.js';

  import Button from '../UI/Button.svelte';
  import Badge from '../UI/Badge.svelte';

  export let title;
  export let subtitle;
  export let imageUrl;
  export let description;
  export let address;
  export let email;
  export let id;
  export let isFav;

  let isLoading = false;

  const dispatch = createEventDispatcher();

  function onToggleFavorite() {
    isLoading = true;
    fetch(`https://vue-http-exmp-default-rtdb.firebaseio.com/meetups/${id}.json`, {
        method: 'PATCH',
        body: JSON.stringify({ isFavorite: !isFav}),
        headers: {
          'Content-Type': 'application/json'
        }
      }).then(res => {
        if(!res.ok) {
          throw new Error('Error changing favorite status!');
        }
        isLoading = false;
        meetups.toggleFavorite(id);
      }).catch(err => {
        isLoading = false;
        console.log(err);
      });
  }
</script>

<style>
  article {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.26);
    border-radius: 5px;
    background: white;
    margin: 1rem;
  }

  header,
  .content,
  footer {
    padding: 1rem;
  }

  .image {
    width: 100%;
    height: 14rem;
  }

  .image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  h1 {
    font-size: 1.25rem;
    margin: 0.5rem 0;
    font-family: "Roboto Slab", sans-serif;
  }

  h1.is-favorite {
    background: #01a129;
    color: white;
    padding: 0 0.5rem;
    border-radius: 5px;
  }

  h2 {
    font-size: 1rem;
    color: #808080;
    margin: 0.5rem 0;
  }

  p {
    font-size: 1.25rem;
    margin: 0;
  }

  div {
    text-align: right;
  }

  .changing-fav {
    font: inherit;
    border: 1px solid #cf0056;
    background: #cf0056;
    padding: 0.5rem 1rem;
    color: white;
    border-radius: 5px;
    box-shadow: 1px 1px 3px rgba(0, 0, 0, 0.26);
    cursor: progress;
  }
</style>

<article>
  <header>
    <h1>
      {title} 
      {#if isFav}
        <Badge>Favorite</Badge>
      {/if}
    </h1>
    <h2>{subtitle}</h2>
    <p>{address}</p>
  </header>
  <div class="image">
    <img src="{imageUrl}" alt="{title}">
  </div>
  <div class="content">
    <p>{description}</p>
  </div>
  <footer>
    <!-- <Button href="mailto:{email}">Contact</Button> -->
    <Button mode="outline" type="button" on:click="{dispatch('edit-meetup', id)}">Edit</Button>
    {#if isLoading}
      <span class="changing-fav">{isFav? 'Unfavoriting' : 'Favoriting' }...</span>
    {:else}
      <Button 
        type="button" 
        mode="outline" 
        color={isFav? null : 'success'}
        on:click="{onToggleFavorite}">
        {isFav? 'Unfavorite' : 'Favorite'}
      </Button>
    {/if}
    <Button type="button" on:click="{() => dispatch('show-details', id)}">Show Details</Button>
  </footer>
</article>